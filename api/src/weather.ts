/**
 * Fills in the weather for catches, from Open-Meteo (free, no key, non-commercial use).
 *
 * Runs inside sync, after pushed changes are written:
 *  - catches written in this request get weather straight away (when the service answers), and
 *  - each sync also backfills a few older catches in the caller's own partition that have none,
 *    or whose time or place changed since their weather was looked up.
 *
 * Weather is stored as its own `catchWeather` record (id `wx_<catchId>`, same partition and pondId
 * as the catch), never on the catch: the server editing a catch would race with edits on the phone
 * under last-writer-wins.
 *
 * Lookups are bounded so sync stays fast: a few HTTP calls per sync, each with a short timeout,
 * all in parallel. A failure just means the catch is tried again on a later sync. When the service
 * answers but has no data for that time and place, the record is written with status
 * 'unavailable' so it isn't retried until the catch's time or place changes.
 */
import type { DocStore } from './store';
import type { SyncDoc } from './types';

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface WeatherDeps {
  fetch: FetchLike;
  now: () => Date;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** HTTP calls per sync. */
  maxCalls?: number;
  log?: (msg: string) => void;
}

/** What a catch needs for a lookup. */
export interface WeatherCandidate {
  catchId: string;
  pondId: string;
  partition: string;
  caughtAt: string;
  lat: number;
  lon: number;
}

/** The fields of a catchWeather record that decide whether it's still current. */
export interface WeatherStamp {
  catchId: string;
  caughtAt: string;
  lat: number;
  lon: number;
  status?: 'ok' | 'unavailable';
  updatedAt?: string;
}

export interface CatchWeatherDoc extends SyncDoc {
  type: 'catchWeather';
  catchId: string;
  pondId: string;
  status: 'ok' | 'unavailable';
  caughtAt: string;
  lat: number;
  lon: number;
  airTempF?: number;
  pressureInHg?: number;
  pressureChange3hInHg?: number;
  pressureTrend?: 'rising' | 'steady' | 'falling';
  windMph?: number;
  windDirDeg?: number;
  cloudPct?: number;
  source: 'open-meteo';
}

export const weatherDocId = (catchId: string) => `wx_${catchId}`;

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** ERA5 reanalysis, 1940 to about 5 days ago. */
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
/** The forecast API serves the recent past; older catches go to the archive. */
const FORECAST_MAX_AGE_DAYS = 60;
/** Longest date range in one call. */
const MAX_SPAN_DAYS = 60;
/** Most catches a single sync will try to backfill. */
export const BACKFILL_LIMIT = 150;
const HPA_TO_INHG = 0.0295299830714;
const TREND_THRESHOLD_INHG = 0.03;
const DAY_MS = 86_400_000;
/** "No data" is retried after this long, in case the gap was the service's, not the date's. */
const UNAVAILABLE_RETRY_MS = 7 * DAY_MS;

const HOURLY = ['temperature_2m', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'cloud_cover'] as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Coordinates that would give the same weather (Open-Meteo's grid is ~1–25 km). */
const sameSpot = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

/** Weather is missing or was looked up for a different time or place. */
export function needsWeather(c: WeatherCandidate, stamp: WeatherStamp | undefined, now: Date): boolean {
  if (!stamp) return true;
  if (stamp.caughtAt !== c.caughtAt || !sameSpot(stamp, c)) return true;
  if (stamp.status === 'unavailable') {
    const at = Date.parse(stamp.updatedAt ?? '');
    return !Number.isFinite(at) || now.getTime() - at > UNAVAILABLE_RETRY_MS;
  }
  return false;
}

/**
 * The catch's own coordinates (stamped from the pond when it was logged) or else the pond's
 * current ones. Undefined when neither has GPS: nothing to look up yet.
 */
export function candidateFor(catchDoc: SyncDoc, partition: string, pond: SyncDoc | undefined): WeatherCandidate | undefined {
  if (catchDoc.deletedAt) return undefined;
  const caughtAt = catchDoc['caughtAt'];
  if (typeof caughtAt !== 'string' || Number.isNaN(Date.parse(caughtAt))) return undefined;
  let lat = catchDoc['lat'];
  let lon = catchDoc['lon'];
  if (!isNum(lat) || !isNum(lon)) {
    lat = pond?.['lat'];
    lon = pond?.['lon'];
  }
  if (!isNum(lat) || !isNum(lon)) return undefined;
  return { catchId: catchDoc.id, pondId: String(catchDoc['pondId'] ?? ''), partition, caughtAt, lat, lon };
}

interface Call {
  url: string;
  candidates: WeatherCandidate[];
}

/**
 * Groups candidates into as few calls as possible: same spot and same endpoint, dates within
 * MAX_SPAN_DAYS. Newest catches first, so the ones you're looking at get weather soonest.
 */
export function planCalls(candidates: WeatherCandidate[], now: Date, maxCalls: number): Call[] {
  const nowMs = now.getTime();
  const sorted = [...candidates]
    // Nothing to look up for a catch in the future (a bad clock); it'll be tried once it's past.
    .filter((c) => Date.parse(c.caughtAt) <= nowMs + 3_600_000)
    .sort((a, b) => b.caughtAt.localeCompare(a.caughtAt));
  type Group = { recent: boolean; spot: { lat: number; lon: number }; minMs: number; maxMs: number; items: WeatherCandidate[] };
  const groups: Group[] = [];
  for (const c of sorted) {
    const t = Date.parse(c.caughtAt);
    const recent = nowMs - t < FORECAST_MAX_AGE_DAYS * DAY_MS;
    const g = groups.find(
      (x) => x.recent === recent && sameSpot(x.spot, c) && Math.max(x.maxMs, t) - Math.min(x.minMs, t) <= MAX_SPAN_DAYS * DAY_MS,
    );
    if (g) {
      g.items.push(c);
      g.minMs = Math.min(g.minMs, t);
      g.maxMs = Math.max(g.maxMs, t);
    } else {
      if (groups.length >= maxCalls) continue;
      groups.push({ recent, spot: { lat: c.lat, lon: c.lon }, minMs: t, maxMs: t, items: [c] });
    }
  }
  return groups.map((g) => {
    const params = new URLSearchParams({
      latitude: g.spot.lat.toFixed(4),
      longitude: g.spot.lon.toFixed(4),
      // The day before, for the 3-hour pressure change on catches just after midnight UTC.
      start_date: utcDate(g.minMs - DAY_MS),
      end_date: utcDate(Math.min(g.maxMs, nowMs)),
      hourly: HOURLY.join(','),
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'GMT',
      timeformat: 'unixtime',
    });
    return { url: `${g.recent ? FORECAST_URL : ARCHIVE_URL}?${params.toString()}`, candidates: g.items };
  });
}

export interface HourlySeries {
  time: number[];
  temperature_2m?: (number | null)[];
  pressure_msl?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  cloud_cover?: (number | null)[];
}

export function parseHourly(body: unknown): HourlySeries | undefined {
  const hourly = (body as { hourly?: unknown } | null)?.hourly as Record<string, unknown> | undefined;
  if (!hourly || !Array.isArray(hourly['time'])) return undefined;
  const time = (hourly['time'] as unknown[]).map(Number);
  const out: HourlySeries = { time };
  for (const k of HOURLY) {
    const v = hourly[k];
    if (Array.isArray(v)) out[k] = v.map((x) => (isNum(x) ? x : null));
  }
  return out;
}

/** The weather for one catch: the hour nearest the catch, and the pressure 3 hours before it. */
export type WeatherValues = Pick<
  CatchWeatherDoc,
  'status' | 'airTempF' | 'pressureInHg' | 'pressureChange3hInHg' | 'pressureTrend' | 'windMph' | 'windDirDeg' | 'cloudPct'
>;

export function weatherAt(series: HourlySeries, caughtAt: string): WeatherValues {
  const t = Date.parse(caughtAt) / 1000;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < series.time.length; i++) {
    const d = Math.abs(series.time[i]! - t);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  // Nearest hour must really be within the hour, or the range didn't cover the catch.
  if (best < 0 || bestDiff > 3600) return { status: 'unavailable' };
  const at = (k: keyof Omit<HourlySeries, 'time'>, i: number) => {
    const v = series[k]?.[i];
    return isNum(v) ? v : undefined;
  };

  const temp = at('temperature_2m', best);
  const p = at('pressure_msl', best);
  const before = best >= 3 ? at('pressure_msl', best - 3) : undefined;
  const wind = at('wind_speed_10m', best);
  const dir = at('wind_direction_10m', best);
  const cloud = at('cloud_cover', best);
  if (temp === undefined && p === undefined && wind === undefined && cloud === undefined) return { status: 'unavailable' };

  const out: WeatherValues = { status: 'ok' };
  if (temp !== undefined) out.airTempF = round(temp, 1);
  if (p !== undefined) out.pressureInHg = round(p * HPA_TO_INHG, 2);
  if (p !== undefined && before !== undefined) {
    const change = (p - before) * HPA_TO_INHG;
    out.pressureChange3hInHg = round(change, 3);
    out.pressureTrend = change >= TREND_THRESHOLD_INHG ? 'rising' : change <= -TREND_THRESHOLD_INHG ? 'falling' : 'steady';
  }
  if (wind !== undefined) out.windMph = round(wind, 1);
  if (dir !== undefined) out.windDirDeg = Math.round(dir);
  if (cloud !== undefined) out.cloudPct = Math.round(cloud);
  return out;
}

type CallResult = { kind: 'ok'; series: HourlySeries } | { kind: 'unavailable' } | { kind: 'failed'; why: string };

async function runCall(call: Call, deps: WeatherDeps): Promise<CallResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? 4000);
  try {
    const res = await deps.fetch(call.url, { signal: ac.signal });
    // 400 = date or place the service doesn't cover. Anything else (429, 5xx) is worth retrying.
    if (res.status === 400) return { kind: 'unavailable' };
    if (!res.ok) return { kind: 'failed', why: `HTTP ${res.status}` };
    const series = parseHourly(await res.json());
    return series ? { kind: 'ok', series } : { kind: 'failed', why: 'unexpected response' };
  } catch (e) {
    return { kind: 'failed', why: ac.signal.aborted ? 'timeout' : String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Looks up and stores weather for the given catches. Returns how many records were written. */
export async function lookUpWeather(store: DocStore, candidates: WeatherCandidate[], deps: WeatherDeps): Promise<number> {
  if (!candidates.length) return 0;
  const calls = planCalls(candidates, deps.now(), deps.maxCalls ?? 3);
  const results = await Promise.all(calls.map((c) => runCall(c, deps)));
  let written = 0;
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]!;
    const r = results[i]!;
    if (r.kind === 'failed') {
      deps.log?.(`weather: lookup failed (${r.why}) for ${call.candidates.length} catch(es); will retry`);
      continue;
    }
    for (const c of call.candidates) {
      const values: WeatherValues = r.kind === 'ok' ? weatherAt(r.series, c.caughtAt) : { status: 'unavailable' };
      const ts = deps.now().toISOString();
      const doc: CatchWeatherDoc = {
        id: weatherDocId(c.catchId),
        type: 'catchWeather',
        userId: c.partition,
        catchId: c.catchId,
        pondId: c.pondId,
        caughtAt: c.caughtAt,
        lat: c.lat,
        lon: c.lon,
        source: 'open-meteo',
        ...values,
        updatedAt: ts,
        serverUpdatedAt: ts,
      };
      await store.upsert(doc);
      written++;
    }
  }
  return written;
}

/**
 * Weather for catches written in this sync (any partition, e.g. a member's catch in a shared
 * pond), plus a backfill of the caller's own partition.
 */
export async function enrichWeather(
  store: DocStore,
  viewerId: string,
  written: { doc: SyncDoc; partition: string }[],
  deps: WeatherDeps,
): Promise<number> {
  const byKey = new Map<string, WeatherCandidate>();

  // 1. Just written. Use the pond from the same partition for location when the catch has none.
  for (const { doc, partition } of written) {
    if (doc.type !== 'catch') continue;
    const pond = await store.read(String(doc['pondId'] ?? ''), partition);
    const c = candidateFor(doc, partition, pond);
    if (!c) continue;
    const stamp = (await store.read(weatherDocId(c.catchId), partition)) as WeatherStamp | undefined;
    if (needsWeather(c, stamp, deps.now())) byKey.set(`${partition}|${c.catchId}`, c);
  }

  // 2. Backfill the caller's own partition.
  const scan = await store.weatherScan(viewerId);
  const ponds = new Map(scan.ponds.map((p) => [p.id, p]));
  const stamps = new Map(scan.weather.map((w) => [w.catchId, w]));
  for (const doc of scan.catches) {
    if (byKey.size >= BACKFILL_LIMIT) break;
    const key = `${viewerId}|${doc.id}`;
    if (byKey.has(key)) continue;
    const c = candidateFor(doc, viewerId, ponds.get(String(doc['pondId'] ?? '')));
    if (c && needsWeather(c, stamps.get(c.catchId), deps.now())) byKey.set(key, c);
  }

  return lookUpWeather(store, [...byKey.values()], deps);
}
