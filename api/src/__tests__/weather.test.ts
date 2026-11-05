import { describe, expect, it } from 'vitest';
import { applyChanges, fetchChanges, loadAccess, createInvite, joinWithCode, type Viewer } from '../sharing';
import type { SyncDoc } from '../types';
import {
  BACKFILL_LIMIT,
  enrichWeather,
  needsWeather,
  parseHourly,
  planCalls,
  weatherAt,
  weatherDocId,
  type FetchLike,
  type HourlySeries,
  type WeatherCandidate,
} from '../weather';
import { createMemoryStore } from './memoryStore';

const NOW = new Date('2026-11-05T13:00:00.000Z');
const POND = { lat: 38.8114, lon: -94.9272 };
const OWNER: Viewer = { userId: 'owner-1', name: 'sean@example.com' };
const BUDDY: Viewer = { userId: 'buddy-2', name: 'buddy@example.com' };

const hour = (iso: string) => Date.parse(iso) / 1000;

/** 48 hours of hourly data starting at `startIso`, pressure falling 1 hPa per hour from 1020. */
function series(startIso: string, hours = 48): HourlySeries {
  const t0 = hour(startIso);
  const time = Array.from({ length: hours }, (_, i) => t0 + i * 3600);
  return {
    time,
    temperature_2m: time.map((_, i) => 50 + i),
    pressure_msl: time.map((_, i) => 1020 - i),
    wind_speed_10m: time.map(() => 8.44),
    wind_direction_10m: time.map(() => 224.6),
    cloud_cover: time.map(() => 40),
  };
}

/** A fake Open-Meteo: answers every call with hourly data covering the requested dates. */
function fakeOpenMeteo(opts: { status?: number; throws?: boolean } = {}) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    if (opts.throws) throw new Error('network down');
    if (opts.status && opts.status !== 200) return { ok: false, status: opts.status, json: async () => ({ reason: 'x' }) };
    const u = new URL(url);
    const start = `${u.searchParams.get('start_date')}T00:00:00Z`;
    const days = (Date.parse(`${u.searchParams.get('end_date')}T00:00:00Z`) - Date.parse(start)) / 86_400_000 + 1;
    return { ok: true, status: 200, json: async () => ({ latitude: 38.8, longitude: -94.9, hourly: series(start, days * 24) }) };
  };
  return { fetch, calls };
}

const fish = (id: string, caughtAt: string, extra: Record<string, unknown> = {}): SyncDoc => ({
  id,
  type: 'catch',
  userId: 'x',
  pondId: 'P1',
  caughtAt,
  lengthIn: 15,
  weightLb: 1.5,
  ...POND,
  updatedAt: '2026-11-05T12:00:00.000Z',
  ...extra,
});

describe('weatherAt', () => {
  const s = series('2026-11-04T00:00:00Z');

  it('reads the nearest hour and converts units', () => {
    const w = weatherAt(s, '2026-11-04T10:20:00Z');
    expect(w).toMatchObject({ status: 'ok', airTempF: 60, windMph: 8.4, windDirDeg: 225, cloudPct: 40 });
    // 1010 hPa = 29.83 inHg
    expect(w.pressureInHg).toBeCloseTo(29.83, 2);
  });

  it('works out the 3-hour pressure trend', () => {
    const w = weatherAt(s, '2026-11-04T10:00:00Z');
    // -3 hPa over 3 hours = -0.089 inHg
    expect(w.pressureChange3hInHg).toBeCloseTo(-0.089, 3);
    expect(w.pressureTrend).toBe('falling');
  });

  it('leaves the trend off when the 3 hours before aren’t in the data', () => {
    const w = weatherAt(s, '2026-11-04T01:00:00Z');
    expect(w.pressureInHg).toBeDefined();
    expect(w.pressureTrend).toBeUndefined();
  });

  it('is unavailable when the data doesn’t cover the catch', () => {
    expect(weatherAt(s, '2026-11-10T10:00:00Z')).toEqual({ status: 'unavailable' });
  });

  it('is unavailable when every value is missing', () => {
    const empty: HourlySeries = { time: s.time, temperature_2m: s.time.map(() => null), pressure_msl: s.time.map(() => null) };
    expect(weatherAt(empty, '2026-11-04T10:00:00Z')).toEqual({ status: 'unavailable' });
  });

  it('parses an Open-Meteo body and tolerates junk', () => {
    expect(parseHourly({ hourly: { time: [1, 2], temperature_2m: [3, null], pressure_msl: ['x', 1000] } })).toEqual({
      time: [1, 2],
      temperature_2m: [3, null],
      pressure_msl: [null, 1000],
    });
    expect(parseHourly({ error: true, reason: 'bad' })).toBeUndefined();
    expect(parseHourly(null)).toBeUndefined();
  });
});

describe('planCalls', () => {
  const cand = (id: string, caughtAt: string, spot = POND): WeatherCandidate => ({ catchId: id, pondId: 'P1', partition: 'p', caughtAt, ...spot });

  it('groups catches at one pond into one call and uses the forecast API for recent ones', () => {
    const calls = planCalls([cand('a', '2026-11-04T10:00:00Z'), cand('b', '2026-10-20T10:00:00Z')], NOW, 3);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('start_date')).toBe('2026-10-19');
    expect(u.searchParams.get('end_date')).toBe('2026-11-04');
    expect(u.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(u.searchParams.get('wind_speed_unit')).toBe('mph');
    expect(u.searchParams.get('hourly')).toBe('temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover');
  });

  it('sends older catches to the archive, and splits ponds and long spans', () => {
    const calls = planCalls(
      [
        cand('new', '2026-11-04T10:00:00Z'),
        cand('old', '2025-06-01T10:00:00Z'),
        cand('older', '2025-01-01T10:00:00Z'),
        cand('other-pond', '2026-11-03T10:00:00Z', { lat: 38.9, lon: -94.8 }),
      ],
      NOW,
      10,
    );
    expect(calls).toHaveLength(4);
    expect(calls.filter((c) => c.url.startsWith('https://archive-api.open-meteo.com/v1/archive'))).toHaveLength(2);
  });

  it('caps the number of calls, keeping the newest catches', () => {
    const many = Array.from({ length: 6 }, (_, i) => cand(`c${i}`, `2026-0${i + 1}-15T10:00:00Z`, { lat: 38 + i, lon: -94 }));
    const calls = planCalls(many, NOW, 2);
    expect(calls.flatMap((c) => c.candidates.map((x) => x.catchId))).toEqual(['c5', 'c4']);
  });

  it('skips catches dated in the future', () => {
    expect(planCalls([cand('f', '2026-12-01T10:00:00Z')], NOW, 3)).toEqual([]);
  });
});

describe('needsWeather', () => {
  const c: WeatherCandidate = { catchId: 'a', pondId: 'P1', partition: 'p', caughtAt: '2026-11-04T10:00:00Z', ...POND };
  it('is true for a new catch, a changed time or a moved pond; false when current', () => {
    expect(needsWeather(c, undefined, NOW)).toBe(true);
    expect(needsWeather(c, { catchId: 'a', caughtAt: c.caughtAt, ...POND, status: 'ok' }, NOW)).toBe(false);
    expect(needsWeather(c, { catchId: 'a', caughtAt: '2026-11-04T09:00:00Z', ...POND }, NOW)).toBe(true);
    expect(needsWeather(c, { catchId: 'a', caughtAt: c.caughtAt, lat: 39.5, lon: -94.9 }, NOW)).toBe(true);
  });
  it('retries "unavailable" after a week', () => {
    const stamp = { catchId: 'a', caughtAt: c.caughtAt, ...POND, status: 'unavailable' as const };
    expect(needsWeather(c, { ...stamp, updatedAt: '2026-11-01T00:00:00Z' }, NOW)).toBe(false);
    expect(needsWeather(c, { ...stamp, updatedAt: '2026-10-20T00:00:00Z' }, NOW)).toBe(true);
  });
});

describe('weather during sync', () => {
  async function setup(fetchOpts?: Parameters<typeof fakeOpenMeteo>[0]) {
    const mem = createMemoryStore();
    const api = fakeOpenMeteo(fetchOpts);
    let tick = NOW.getTime();
    const now = () => new Date((tick += 1000));
    const deps = { fetch: api.fetch, now };
    const sync = async (v: Viewer, changes: SyncDoc[]) => {
      const access = await loadAccess(mem.store, v.userId);
      const { written } = await applyChanges(mem.store, v, access, changes, now);
      return enrichWeather(mem.store, v.userId, written, deps);
    };
    return { mem, api, sync, now };
  }

  it('fills weather for a new catch as its own record with the catch’s pond', async () => {
    const { mem, api, sync } = await setup();
    await sync(OWNER, [{ id: 'P1', type: 'pond', userId: 'x', name: 'Big', ...POND, updatedAt: '2026-11-01T00:00:00Z' }]);
    expect(api.calls).toHaveLength(0);
    expect(await sync(OWNER, [fish('C1', '2026-11-04T10:00:00Z')])).toBe(1);
    expect(api.calls).toHaveLength(1);
    expect(mem.get(weatherDocId('C1'), OWNER.userId)).toMatchObject({
      type: 'catchWeather',
      catchId: 'C1',
      pondId: 'P1',
      status: 'ok',
      // Fake data starts the day before (start_date), so 10:00 the next day is hour 34.
      airTempF: 84,
      windMph: 8.4,
      pressureTrend: 'falling',
      source: 'open-meteo',
    });
    // The catch itself is untouched.
    expect(mem.get('C1', OWNER.userId)).not.toHaveProperty('airTempF');
  });

  it('doesn’t look it up again on the next sync, but does after the catch time changes', async () => {
    const { api, sync } = await setup();
    await sync(OWNER, [fish('C1', '2026-11-04T10:00:00Z')]);
    await sync(OWNER, []);
    expect(api.calls).toHaveLength(1);
    await sync(OWNER, [fish('C1', '2026-11-04T07:00:00Z', { updatedAt: '2026-11-05T12:30:00.000Z' })]);
    expect(api.calls).toHaveLength(2);
  });

  it('uses the pond’s GPS when the catch has none, and skips catches with no location at all', async () => {
    const { mem, api, sync } = await setup();
    await sync(OWNER, [
      { id: 'P1', type: 'pond', userId: 'x', name: 'Big', ...POND, updatedAt: '2026-11-01T00:00:00Z' },
      { id: 'P2', type: 'pond', userId: 'x', name: 'No GPS', updatedAt: '2026-11-01T00:00:00Z' },
    ]);
    await sync(OWNER, [
      fish('C1', '2026-11-04T10:00:00Z', { lat: undefined, lon: undefined }),
      fish('C2', '2026-11-04T10:00:00Z', { pondId: 'P2', lat: undefined, lon: undefined }),
    ]);
    expect(mem.get(weatherDocId('C1'), OWNER.userId)?.['status']).toBe('ok');
    expect(mem.get(weatherDocId('C2'), OWNER.userId)).toBeUndefined();
    expect(api.calls).toHaveLength(1);
  });

  it('backfills older catches already on the server', async () => {
    const { mem, api, sync } = await setup();
    for (const [id, when] of [
      ['old1', '2025-06-01T10:00:00Z'],
      ['old2', '2025-06-03T10:00:00Z'],
      ['recent', '2026-11-01T10:00:00Z'],
    ] as const) {
      await mem.store.upsert({ ...fish(id, when), userId: OWNER.userId, serverUpdatedAt: '2026-01-01T00:00:00Z' });
    }
    expect(await sync(OWNER, [])).toBe(3);
    expect(api.calls).toHaveLength(2); // one recent (forecast), one old (archive)
  });

  it('caps a single backfill', async () => {
    const { mem, sync } = await setup();
    for (let i = 0; i < BACKFILL_LIMIT + 20; i++) {
      const when = new Date(Date.parse('2026-10-01T00:00:00Z') + i * 3_600_000).toISOString();
      await mem.store.upsert({ ...fish(`c${i}`, when), userId: OWNER.userId, serverUpdatedAt: '2026-01-01T00:00:00Z' });
    }
    expect(await sync(OWNER, [])).toBe(BACKFILL_LIMIT);
    expect(await sync(OWNER, [])).toBe(20);
  });

  it('records "unavailable" when the service has no data, and retries nothing on a network failure', async () => {
    const bad = await setup({ status: 400 });
    await bad.sync(OWNER, [fish('C1', '2026-11-04T10:00:00Z')]);
    expect(bad.mem.get(weatherDocId('C1'), OWNER.userId)?.['status']).toBe('unavailable');

    const down = await setup({ throws: true });
    expect(await down.sync(OWNER, [fish('C1', '2026-11-04T10:00:00Z')])).toBe(0);
    expect(down.mem.get(weatherDocId('C1'), OWNER.userId)).toBeUndefined();
    expect(down.mem.get('C1', OWNER.userId)).toBeDefined(); // the catch still saved

    const busy = await setup({ status: 503 });
    expect(await busy.sync(OWNER, [fish('C1', '2026-11-04T10:00:00Z')])).toBe(0);
  });

  it('a member’s catch in a shared pond gets weather in the owner’s partition, and both pull it', async () => {
    const { mem, sync, now } = await setup();
    await sync(OWNER, [{ id: 'P1', type: 'pond', userId: 'x', name: 'Big', ...POND, updatedAt: '2026-11-01T00:00:00Z' }]);
    await createInvite(mem.store, OWNER, 'P1', now, () => 'ABCD2345');
    await joinWithCode(mem.store, BUDDY, 'ABCD2345', now);

    await sync(BUDDY, [fish('CB', '2026-11-04T10:00:00Z')]);
    expect(mem.get(weatherDocId('CB'), OWNER.userId)?.['status']).toBe('ok');
    expect(mem.get(weatherDocId('CB'), BUDDY.userId)).toBeUndefined();

    const buddyPull = await fetchChanges(mem.store, BUDDY, await loadAccess(mem.store, BUDDY.userId), null);
    const ownerPull = await fetchChanges(mem.store, OWNER, await loadAccess(mem.store, OWNER.userId), null);
    expect(buddyPull.some((d) => d.id === weatherDocId('CB'))).toBe(true);
    expect(ownerPull.some((d) => d.id === weatherDocId('CB'))).toBe(true);
  });

  it('the app can’t write weather records', async () => {
    const { mem } = await setup();
    const access = await loadAccess(mem.store, OWNER.userId);
    const r = await applyChanges(mem.store, OWNER, access, [{ id: 'wx_X', type: 'catchWeather' as never, userId: 'x', updatedAt: '2026-11-01T00:00:00Z' }], () => NOW);
    expect(r.rejected).toHaveLength(1);
  });
});
