import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLOT, DEFAULT_THRESHOLDS } from '@pond-tracker/shared';
import { PondTrackerDB, initDb } from '../../db/db';
import { createRepo, type Repo } from '../../db/repo';
import { SYNC_STATE_ID, countPending, createSyncEngine, type FetchLike, type SyncDoc } from '../sync';

interface ServerDoc extends SyncDoc {
  serverUpdatedAt: string;
}

/** In-memory stand-in for the API: same LWW / serverUpdatedAt / since semantics as api/src/functions/sync.ts. */
function createFakeServer() {
  const docs = new Map<string, ServerDoc>();
  const blobs = new Map<string, Blob>();
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  // Strictly increasing so `serverUpdatedAt > since` is exact even within one millisecond.
  const tick = () => new Date(++clock).toISOString();
  let status = 200;
  /** Runs while a /api/sync request is "in flight", before the response is built. */
  let beforeSyncResponse: (() => Promise<void>) | undefined;

  const json = (body: unknown, s = 200) => new Response(JSON.stringify(body), { status: s, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (url.startsWith('https://')) {
      calls.push({ method, url, headers, body: init.body });
      const name = new URL(url).pathname;
      blobs.set(name, init.body as Blob);
      return new Response(null, { status: 201 });
    }
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, headers, body });
    if (status !== 200) return json({ error: 'nope' }, status);
    if (url === '/api/photos/upload-url') {
      const { photoId } = body as { photoId: string };
      return json({ photoId, blobName: `u1/${photoId}.jpg`, sasUrl: `https://acct.blob.core.windows.net/photos/u1/${photoId}.jpg?sig=x`, expiresOn: tick() });
    }
    if (url === '/api/sync') {
      const { since, changes } = body as { since: string | null; changes: SyncDoc[] };
      if (changes.length > 500) return json({ error: 'too many' }, 413);
      const serverTime = tick();
      for (const c of changes) {
        const existing = docs.get(c.id);
        if (existing && existing.updatedAt >= c.updatedAt) continue;
        docs.set(c.id, { ...c, userId: 'u1', serverUpdatedAt: tick() });
      }
      await beforeSyncResponse?.();
      const serverChanges = [...docs.values()].filter((d) => since === null || d.serverUpdatedAt > since);
      return json({ serverChanges, serverTime });
    }
    return json({ error: 'not found' }, 404);
  };

  return {
    fetchImpl,
    docs,
    blobs,
    calls,
    setStatus: (s: number) => (status = s),
    onSync: (fn: (() => Promise<void>) | undefined) => (beforeSyncResponse = fn),
  };
}

let n = 0;
async function makeDevice(server: ReturnType<typeof createFakeServer>) {
  const db = new PondTrackerDB(`sync-test-${++n}`);
  await initDb(db);
  const repo = createRepo(db);
  const engine = createSyncEngine(db, server.fetchImpl);
  return { db, repo, engine };
}

function makePond(repo: Repo, name = 'Big pond') {
  return repo.savePond({ name, geofenceM: 150, cullSlotMinIn: DEFAULT_SLOT.minIn, cullSlotMaxIn: DEFAULT_SLOT.maxIn, wrThresholds: { ...DEFAULT_THRESHOLDS } });
}

let server: ReturnType<typeof createFakeServer>;
beforeEach(() => {
  server = createFakeServer();
});

/** Indexed access that fails the test instead of yielding undefined (noUncheckedIndexedAccess). */
function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element ${i}`);
  return v;
}

const syncBodies = () => server.calls.filter((c) => c.url === '/api/sync').map((c) => c.body as { since: string | null; changes: SyncDoc[] });

describe('sync engine', () => {
  it('first sync pushes all pending non-sample rows and clears pending', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    const c = await a.repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 14, weightLb: 1.6, outcome: 'released' });
    await a.repo.logFeederFill(pond.id, 50);
    await a.repo.saveSettings({ requirePhoto: true });

    const r = await a.engine.syncNow();
    expect(r).toMatchObject({ status: 'ok', pushed: 4 });
    const first = at(syncBodies(), 0);
    expect(first.since).toBeNull();
    expect(first.changes.map((d) => d.type).sort()).toEqual(['catch', 'feedingLog', 'pond', 'settings']);
    const pushedCatch = first.changes.find((d) => d.id === c.id);
    expect(pushedCatch).not.toHaveProperty('pending');
    expect(server.docs.get('settings')?.requirePhoto).toBe(true);

    expect(await countPending(a.db)).toEqual({ records: 0, photos: 0 });
    const state = await a.db.syncState.get(SYNC_STATE_ID);
    expect(state?.lastServerTime).toBeTruthy();
    expect(state?.lastStatus).toBe('ok');

    // The next run sends nothing and asks only for changes since the stored serverTime.
    await a.engine.syncNow();
    expect(at(syncBodies(), 1)).toEqual({ since: state?.lastServerTime, changes: [] });
  });

  it('never pushes sample rows (or their photos)', async () => {
    const a = await makeDevice(server);
    await a.repo.seedSampleData();
    const sampleCatch = await a.db.catches.filter((x) => x.sample === 1).first();
    await a.db.photos.put({ id: crypto.randomUUID(), catchId: sampleCatch!.id, blob: new Blob(['x']), width: 1, height: 1, bytes: 1, updatedAt: new Date().toISOString(), pending: 1 });
    const own = await makePond(a.repo, 'Mine');

    await a.engine.syncNow();
    expect(at(syncBodies(), 0).changes.map((d) => d.id)).toEqual([own.id]);
    expect(server.calls.some((c) => c.url === '/api/photos/upload-url')).toBe(false);
    expect(await countPending(a.db)).toEqual({ records: 0, photos: 0 });
  });

  it('a second device pulls everything, and its seeded settings yield to the cloud copy', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    const c = await a.repo.addCatch({ pondId: pond.id, speciesId: 'BLG', lengthIn: 7, weightLb: 0.3, outcome: 'kept' });
    await a.repo.saveSettings({ weightUnits: 'lbsOz' });
    await a.engine.syncNow();

    const b = await makeDevice(server);
    const r = await b.engine.syncNow();
    expect(r.status).toBe('ok');
    expect(r.pulled).toBe(3);
    // b's seeded defaults were not pushed over a's settings.
    expect(at(syncBodies(), 1).changes).toEqual([]);
    const pulled = await b.db.catches.get(c.id);
    expect(pulled).toMatchObject({ id: c.id, pondId: pond.id, pending: 0 });
    expect(pulled).not.toHaveProperty('type');
    expect(pulled).not.toHaveProperty('userId');
    expect(pulled).not.toHaveProperty('serverUpdatedAt');
    expect((await b.db.ponds.get(pond.id))?.name).toBe('Big pond');
    expect((await b.repo.getSettings()).weightUnits).toBe('lbsOz');
    expect(await countPending(b.db)).toEqual({ records: 0, photos: 0 });
  });

  it('last writer wins in both directions', async () => {
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    const pond = await makePond(a.repo);
    await a.engine.syncNow();
    await b.engine.syncNow();

    // b edits later than a: b's version wins on the server and overwrites a's older pending edit.
    await a.db.ponds.update(pond.id, { name: 'A edit', updatedAt: '2030-01-01T00:00:00.000Z', pending: 1 });
    await b.db.ponds.update(pond.id, { name: 'B edit', updatedAt: '2030-01-02T00:00:00.000Z', pending: 1 });
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(server.docs.get(pond.id)?.name).toBe('B edit');
    expect(await a.db.ponds.get(pond.id)).toMatchObject({ name: 'B edit', pending: 0 });

    // A newer local edit beats an older server copy: it's pushed, not overwritten by the pull.
    await a.db.ponds.update(pond.id, { name: 'A newer', updatedAt: '2030-01-03T00:00:00.000Z', pending: 1 });
    await a.engine.syncNow();
    expect(server.docs.get(pond.id)?.name).toBe('A newer');
    expect((await a.db.ponds.get(pond.id))?.name).toBe('A newer');
    await b.engine.syncNow();
    expect((await b.db.ponds.get(pond.id))?.name).toBe('A newer');
  });

  it('keeps a row pending when it is edited while the request is in flight', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    server.onSync(async () => {
      await a.db.ponds.update(pond.id, { name: 'Edited mid-sync', updatedAt: '2030-06-01T00:00:00.000Z', pending: 1 });
    });
    await a.engine.syncNow();
    server.onSync(undefined);
    // The echo of the pushed (older) version must not clobber the edit either.
    expect(await a.db.ponds.get(pond.id)).toMatchObject({ name: 'Edited mid-sync', pending: 1 });

    await a.engine.syncNow();
    expect(server.docs.get(pond.id)?.name).toBe('Edited mid-sync');
    expect((await a.db.ponds.get(pond.id))?.pending).toBe(0);
  });

  it('propagates soft deletes and restores', async () => {
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    const pond = await makePond(a.repo);
    const c = await a.repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 12, weightLb: 0.9, outcome: 'released' });
    await a.engine.syncNow();
    await b.engine.syncNow();

    await a.db.catches.update(c.id, { deletedAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z', pending: 1 });
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect((await b.db.catches.get(c.id))?.deletedAt).toBe('2030-01-01T00:00:00.000Z');
    expect(await b.repo.listCatches(pond.id)).toHaveLength(0);

    await b.db.catches.update(c.id, { deletedAt: undefined, updatedAt: '2030-01-02T00:00:00.000Z', pending: 1 });
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect((await a.db.catches.get(c.id))?.deletedAt).toBeUndefined();
  });

  it('401 reports signed-out and leaves everything pending', async () => {
    const a = await makeDevice(server);
    await makePond(a.repo);
    server.setStatus(401);
    const r = await a.engine.syncNow();
    expect(r.status).toBe('signed-out');
    expect(await countPending(a.db)).toEqual({ records: 1, photos: 0 });
    expect((await a.db.syncState.get(SYNC_STATE_ID))?.lastStatus).toBe('signed-out');
    expect((await a.db.syncState.get(SYNC_STATE_ID))?.lastServerTime).toBeUndefined();

    server.setStatus(200);
    expect((await a.engine.syncNow()).status).toBe('ok');
    expect(await countPending(a.db)).toEqual({ records: 0, photos: 0 });
  });

  it('a network failure reports offline', async () => {
    const db = new PondTrackerDB(`sync-test-${++n}`);
    await initDb(db);
    await makePond(createRepo(db));
    const engine = createSyncEngine(db, () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await engine.syncNow()).toMatchObject({ status: 'offline', pushed: 0 });
    expect(await countPending(db)).toEqual({ records: 1, photos: 0 });
  });

  it('batches more than 200 changes', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    const ts = new Date().toISOString();
    await a.db.feedingLogs.bulkPut(
      Array.from({ length: 450 }, (_, i) => ({ id: `f${i}`, pondId: pond.id, kind: 'fill' as const, startedOn: '2026-05-01', createdAt: ts, updatedAt: ts, pending: 1 as const })),
    );
    const r = await a.engine.syncNow();
    expect(r).toMatchObject({ status: 'ok', pushed: 451 });
    expect(syncBodies().map((b) => b.changes.length)).toEqual([200, 200, 51]);
    expect(server.docs.size).toBe(451);
    expect(await countPending(a.db)).toEqual({ records: 0, photos: 0 });
  });

  it('uploads photos (upload-url, then PUT, then the photo doc) and pulls them blob-less elsewhere', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    const c = await a.repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 16, weightLb: 2, outcome: 'released' });
    const photoId = crypto.randomUUID();
    await a.db.photos.put({ id: photoId, catchId: c.id, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 1200, height: 900, bytes: 4, updatedAt: new Date().toISOString(), pending: 1 });
    await a.db.catches.update(c.id, { photoId });

    const r = await a.engine.syncNow();
    expect(r).toMatchObject({ status: 'ok', photosUploaded: 1 });
    const seq = server.calls.map((x) => `${x.method} ${x.url.split('?')[0]}`);
    expect(seq).toEqual(['POST /api/photos/upload-url', `PUT https://acct.blob.core.windows.net/photos/u1/${photoId}.jpg`, 'POST /api/sync']);
    expect(at(server.calls, 0).body).toEqual({ catchId: c.id, contentType: 'image/jpeg', photoId });
    expect(at(server.calls, 1).headers).toMatchObject({ 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'image/jpeg' });
    const photoDoc = at(syncBodies(), 0).changes.find((d) => d.type === 'photo');
    expect(photoDoc).toEqual({ type: 'photo', id: photoId, catchId: c.id, width: 1200, height: 900, bytes: 4, updatedAt: expect.any(String) });
    expect(await countPending(a.db)).toEqual({ records: 0, photos: 0 });
    // The echo didn't strip a's local blob.
    expect((await a.db.photos.get(photoId))?.blob).toBeDefined();

    const b = await makeDevice(server);
    await b.engine.syncNow();
    const pulled = await b.db.photos.get(photoId);
    expect(pulled).toMatchObject({ id: photoId, catchId: c.id, width: 1200, pending: 0 });
    expect(pulled?.blob).toBeUndefined();
    expect((await b.db.catches.get(c.id))?.photoId).toBe(photoId);
    // Hard delete still works on blob-less photo rows.
    await b.repo.hardDeleteCatches([c.id]);
    expect(await b.db.photos.count()).toBe(0);
  });

  it('keeps the blob of a photo saved before sync existed (no updatedAt)', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    const c = await a.repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 16, weightLb: 2, outcome: 'released' });
    const photoId = crypto.randomUUID();
    await a.db.photos.put({ id: photoId, catchId: c.id, blob: new Blob(['x']), width: 1, height: 1, bytes: 1, pending: 1 });
    await a.engine.syncNow();
    const row = await a.db.photos.get(photoId);
    expect(row).toMatchObject({ pending: 0, updatedAt: server.docs.get(photoId)?.updatedAt });
    expect(row?.blob).toBeDefined();
  });

  it('a failed photo upload stays pending while records still sync', async () => {
    const a = await makeDevice(server);
    const pond = await makePond(a.repo);
    const c = await a.repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 16, weightLb: 2, outcome: 'released' });
    await a.db.photos.put({ id: crypto.randomUUID(), catchId: c.id, blob: new Blob(['x']), width: 1, height: 1, bytes: 1, updatedAt: new Date().toISOString(), pending: 1 });
    const engine = createSyncEngine(a.db, (url, init) =>
      url.startsWith('https://') ? Promise.resolve(new Response(null, { status: 403 })) : server.fetchImpl(url, init),
    );
    const r = await engine.syncNow();
    expect(r).toMatchObject({ status: 'ok', photosUploaded: 0, pushed: 2 });
    expect(await countPending(a.db)).toEqual({ records: 0, photos: 1 });
  });

  it('runs once more when asked during an active run', async () => {
    const a = await makeDevice(server);
    await makePond(a.repo);
    const first = a.engine.syncNow();
    const second = a.engine.syncNow();
    expect(second).toBe(first);
    await first;
    expect(syncBodies()).toHaveLength(2);
  });
});
