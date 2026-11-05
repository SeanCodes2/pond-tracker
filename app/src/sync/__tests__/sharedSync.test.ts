import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOT, DEFAULT_THRESHOLDS } from '@pond-tracker/shared';
import { PondTrackerDB, initDb } from '../../db/db';
import { createRepo } from '../../db/repo';
import { canEditCatch, membersOf, roleFor } from '../../lib/sharing';
import { SYNC_STATE_ID, createSyncEngine, type FetchLike, type SyncDoc } from '../sync';

const ME = 'buddy-2';
const OWNER = 'owner-1';

/** A server that answers /api/sync with whatever the test queues, recording what was pushed. */
function scriptedServer() {
  const responses: Array<{ serverChanges: SyncDoc[]; rejected?: unknown[] }> = [];
  const pushed: SyncDoc[][] = [];
  let t = Date.parse('2026-06-01T00:00:00.000Z');
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)) as { changes: SyncDoc[] };
    if (url !== '/api/sync') return new Response('{}', { status: 404 });
    pushed.push(body.changes);
    const next = responses.shift() ?? { serverChanges: [] };
    return new Response(JSON.stringify({ ...next, serverTime: new Date(++t).toISOString(), viewerId: ME }), { status: 200 });
  };
  return { fetchImpl, pushed, queue: (r: { serverChanges: SyncDoc[]; rejected?: unknown[] }) => responses.push(r) };
}

let n = 0;
async function device(fetchImpl: FetchLike) {
  const db = new PondTrackerDB(`shared-sync-test-${++n}`);
  await initDb(db);
  return { db, repo: createRepo(db), engine: createSyncEngine(db, fetchImpl) };
}

const sharedPond: SyncDoc = {
  id: 'P1',
  type: 'pond',
  name: 'Sean’s pond',
  geofenceM: 150,
  cullSlotMinIn: DEFAULT_SLOT.minIn,
  cullSlotMaxIn: DEFAULT_SLOT.maxIn,
  wrThresholds: { ...DEFAULT_THRESHOLDS },
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  userId: OWNER,
  serverUpdatedAt: '2026-05-01T00:00:00.000Z',
};
const membership = (extra: Partial<SyncDoc> = {}): SyncDoc => ({
  id: `pm_P1_${ME}`,
  type: 'pondMember',
  pondId: 'P1',
  ownerId: OWNER,
  ownerName: 'sean@example.com',
  memberId: ME,
  memberName: 'buddy@example.com',
  pondName: 'Sean’s pond',
  role: 'member',
  joinedAt: '2026-05-02T00:00:00.000Z',
  updatedAt: '2026-05-02T00:00:00.000Z',
  ...extra,
});
const ownerCatch: SyncDoc = {
  id: 'C-owner',
  type: 'catch',
  pondId: 'P1',
  speciesId: 'LMB',
  lengthIn: 15,
  weightLb: 1.5,
  wsLb: 1.8,
  wr: 83,
  outcome: 'released',
  caughtAt: '2026-05-01T00:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  loggedBy: OWNER,
  loggedByName: 'sean@example.com',
};

describe('shared ponds on the phone', () => {
  it('stores who you are, the membership and the shared pond; roles follow from them', async () => {
    const server = scriptedServer();
    const { db, engine } = await device(server.fetchImpl);
    server.queue({ serverChanges: [sharedPond, membership(), ownerCatch] });
    const r = await engine.syncNow();
    expect(r.status).toBe('ok');

    expect((await db.syncState.get(SYNC_STATE_ID))?.viewerId).toBe(ME);
    const members = await db.pondMembers.toArray();
    expect(members).toHaveLength(1);
    expect(members[0]).not.toHaveProperty('userId'); // server-only field stripped
    expect(await db.ponds.get('P1')).toMatchObject({ name: 'Sean’s pond', pending: 0 });

    expect(roleFor('P1', members, ME)).toBe('member');
    expect(roleFor('MY-POND', members, ME)).toBe('owner');
    // The owner's phone sees the same row as one of "their members".
    expect(roleFor('P1', members, OWNER)).toBe('owner');
    expect(membersOf('P1', members, OWNER).map((m) => m.memberId)).toEqual([ME]);

    const c = (await db.catches.get('C-owner'))!;
    expect(canEditCatch(c, 'member', ME)).toBe(false);
    expect(canEditCatch(c, 'owner', OWNER)).toBe(true);
    expect(canEditCatch({ loggedBy: undefined }, 'member', ME)).toBe(true); // logged on this phone, not synced yet
  });

  it('restores the server copy of a refused edit, and drops a refused new row', async () => {
    const server = scriptedServer();
    const { db, repo, engine } = await device(server.fetchImpl);
    server.queue({ serverChanges: [sharedPond, membership(), ownerCatch] });
    await engine.syncNow();

    await repo.updateCatch('C-owner', { weightLb: 9 });
    const log = await repo.saveFeedingLog({ pondId: 'P1', startedOn: '2026-06-01', kind: 'fill' });
    server.queue({
      serverChanges: [],
      rejected: [
        { id: 'C-owner', type: 'catch', reason: 'nope', doc: { ...ownerCatch, userId: OWNER, serverUpdatedAt: 'x' } },
        { id: log.id, type: 'feedingLog', reason: 'nope' },
      ],
    });
    const r = await engine.syncNow();
    expect(r.rejected).toBe(2);
    expect(await db.catches.get('C-owner')).toMatchObject({ weightLb: 1.5, pending: 0 });
    expect(await db.feedingLogs.get(log.id)).toBeUndefined();
  });

  it('wipes a shared pond off the phone when you are removed, leaving your own ponds alone', async () => {
    const server = scriptedServer();
    const { db, repo, engine } = await device(server.fetchImpl);
    server.queue({ serverChanges: [sharedPond, membership(), ownerCatch, { id: 'ph1', type: 'photo', catchId: 'C-owner', width: 1, height: 1, bytes: 1, updatedAt: '2026-05-01T00:00:00.000Z' }] });
    await engine.syncNow();
    const mine = await repo.savePond({ name: 'Mine', geofenceM: 150, cullSlotMinIn: 8, cullSlotMaxIn: 12, wrThresholds: { ...DEFAULT_THRESHOLDS } });
    await repo.addCatch({ pondId: 'P1', speciesId: 'BLG', lengthIn: 7, weightLb: 0.3, outcome: 'released' });
    expect(await db.photos.count()).toBe(1);

    server.queue({ serverChanges: [membership({ deletedAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z' })] });
    await engine.syncNow();

    expect(await db.ponds.get('P1')).toBeUndefined();
    expect(await db.catches.where('pondId').equals('P1').count()).toBe(0);
    expect(await db.photos.count()).toBe(0);
    expect(await db.pondMembers.count()).toBe(0);
    expect(await db.ponds.get(mine.id)).toBeDefined();
  });

  it('stores weather records from the server and drops them with the shared pond', async () => {
    const server = scriptedServer();
    const { db, engine } = await device(server.fetchImpl);
    const wx: SyncDoc = {
      id: 'wx_C-owner',
      type: 'catchWeather',
      catchId: 'C-owner',
      pondId: 'P1',
      status: 'ok',
      caughtAt: '2026-05-01T00:00:00.000Z',
      lat: 38.8,
      lon: -94.9,
      airTempF: 61.2,
      pressureInHg: 30.01,
      pressureTrend: 'falling',
      source: 'open-meteo',
      updatedAt: '2026-06-01T00:00:00.000Z',
      userId: OWNER,
    };
    server.queue({ serverChanges: [sharedPond, membership(), ownerCatch, wx] });
    await engine.syncNow();
    expect(await db.catchWeather.where('catchId').equals('C-owner').first()).toMatchObject({ airTempF: 61.2, pressureTrend: 'falling' });
    // The weather record is never pushed back.
    await engine.syncNow();
    expect(server.pushed.flat().some((d) => d.type === 'catchWeather')).toBe(false);

    server.queue({ serverChanges: [membership({ deletedAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z' })] });
    await engine.syncNow();
    expect(await db.catchWeather.count()).toBe(0);
  });

  it('works with a server that predates sharing (no viewerId / rejected)', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ serverChanges: [], serverTime: '2026-06-01T00:00:00.000Z' }), { status: 200 });
    const { engine } = await device(fetchImpl);
    const r = await engine.syncNow();
    expect(r).toMatchObject({ status: 'ok', rejected: 0 });
  });
});
