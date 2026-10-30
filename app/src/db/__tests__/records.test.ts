import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLOT, DEFAULT_THRESHOLDS } from '@pond-tracker/shared';
import { PondTrackerDB, initDb } from '../db';
import { createRepo, type Repo } from '../repo';

let db: PondTrackerDB;
let repo: Repo;
let n = 0;

beforeEach(async () => {
  db = new PondTrackerDB(`records-test-${++n}`);
  repo = createRepo(db);
  await initDb(db);
});

async function makePond(name = 'Big pond') {
  return repo.savePond({
    name,
    geofenceM: 150,
    cullSlotMinIn: DEFAULT_SLOT.minIn,
    cullSlotMaxIn: DEFAULT_SLOT.maxIn,
    wrThresholds: { ...DEFAULT_THRESHOLDS },
  });
}

async function makeCatch(pondId: string, lengthIn = 12) {
  return repo.addCatch({ pondId, speciesId: 'LMB', lengthIn, weightLb: 1, outcome: 'released' });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('pond cascade delete / undo', () => {
  it('soft-deletes the pond, its catches and feeding logs with one timestamp', async () => {
    const p = await makePond();
    const other = await makePond('Other');
    const c1 = await makeCatch(p.id);
    const c2 = await makeCatch(p.id);
    const keep = await makeCatch(other.id);
    await repo.saveFeedingLog({ pondId: p.id, startedOn: '2026-04-01' });

    const res = await repo.softDeletePondCascade(p.id);
    expect(res.catches).toBe(2);
    expect(res.feedingLogs).toBe(1);

    expect(await repo.getPond(p.id)).toBeUndefined();
    expect(await repo.listCatches(undefined)).toHaveLength(1);
    expect((await repo.listCatches(undefined))[0]?.id).toBe(keep.id);
    expect(await repo.listFeedingLogs(p.id)).toHaveLength(0);

    const rows = await db.catches.where('id').anyOf([c1.id, c2.id]).toArray();
    for (const r of rows) expect(r.deletedAt).toBe(res.deletedAt);
    expect((await db.ponds.get(p.id))?.deletedAt).toBe(res.deletedAt);
  });

  it('restorePondCascade only resurrects rows from the same cascade', async () => {
    const p = await makePond();
    const earlier = await makeCatch(p.id, 8);
    const live = await makeCatch(p.id, 14);
    await repo.saveFeedingLog({ pondId: p.id, startedOn: '2026-04-01' });

    await repo.softDeleteCatch(earlier.id);
    await wait(5); // ensure a different ISO timestamp
    const res = await repo.softDeletePondCascade(p.id);
    expect(res.catches).toBe(1);

    const undo = await repo.restorePondCascade(p.id, res.deletedAt);
    expect(undo.catches).toBe(1);
    expect(undo.feedingLogs).toBe(1);

    expect(await repo.getPond(p.id)).toBeDefined();
    expect((await repo.listCatches(p.id)).map((c) => c.id)).toEqual([live.id]);
    expect((await db.catches.get(earlier.id))?.deletedAt).toBeTruthy();
    expect(await repo.listFeedingLogs(p.id)).toHaveLength(1);
  });

  it('restorePondCascade without a timestamp uses the pond deletedAt', async () => {
    const p = await makePond();
    await makeCatch(p.id);
    await repo.softDeletePondCascade(p.id);
    const undo = await repo.restorePondCascade(p.id);
    expect(undo.catches).toBe(1);
    expect(await repo.listCatches(p.id)).toHaveLength(1);
  });
});

describe('bulk catches', () => {
  it('softDeleteCatches / restoreCatches round trip', async () => {
    const p = await makePond();
    const a = await makeCatch(p.id);
    const b = await makeCatch(p.id);
    const c = await makeCatch(p.id);
    expect(await repo.softDeleteCatches([a.id, b.id])).toBe(2);
    expect((await repo.listCatches(p.id)).map((x) => x.id)).toEqual([c.id]);
    expect(await repo.listDeletedCatches()).toHaveLength(2);
    expect(await repo.restoreCatches([a.id, b.id])).toBe(2);
    expect(await repo.listCatches(p.id)).toHaveLength(3);
    expect(await repo.softDeleteCatches([])).toBe(0);
  });

  it('restoreCatch also restores a deleted pond', async () => {
    const p = await makePond();
    const c = await makeCatch(p.id);
    await repo.softDeletePondCascade(p.id);
    const res = await repo.restoreCatch(c.id);
    expect(res.pondRestored).toBe(true);
    expect(await repo.getPond(p.id)).toBeDefined();
    expect(await repo.listCatches(p.id)).toHaveLength(1);

    await repo.softDeleteCatch(c.id);
    expect((await repo.restoreCatch(c.id)).pondRestored).toBe(false);
  });
});

describe('recently deleted lists and hard delete', () => {
  it('lists deleted ponds and catches newest first', async () => {
    const p1 = await makePond('First');
    const p2 = await makePond('Second');
    await repo.softDeletePond(p1.id);
    await wait(5);
    await repo.softDeletePond(p2.id);
    expect((await repo.listDeletedPonds()).map((p) => p.name)).toEqual(['Second', 'First']);
  });

  it('hardDeleteCatches removes rows and photos', async () => {
    const p = await makePond();
    const c = await makeCatch(p.id);
    await db.photos.put({ id: 'ph1', catchId: c.id, blob: new Blob(['x']), width: 1, height: 1, bytes: 1, pending: 1 });
    await repo.softDeleteCatch(c.id);
    expect(await repo.hardDeleteCatches([c.id])).toBe(1);
    expect(await db.catches.get(c.id)).toBeUndefined();
    expect(await db.photos.count()).toBe(0);
  });

  it('hardDeletePond cascades to catches, photos and feeding logs', async () => {
    const p = await makePond();
    const other = await makePond('Other');
    const c = await makeCatch(p.id);
    await makeCatch(other.id);
    await db.photos.put({ id: 'ph1', catchId: c.id, blob: new Blob(['x']), width: 1, height: 1, bytes: 1, pending: 1 });
    await repo.saveFeedingLog({ pondId: p.id, startedOn: '2026-04-01' });
    const res = await repo.hardDeletePond(p.id);
    expect(res).toEqual({ catches: 1, feedingLogs: 1 });
    expect(await db.ponds.get(p.id)).toBeUndefined();
    expect(await db.catches.count()).toBe(1);
    expect(await db.photos.count()).toBe(0);
    expect(await db.feedingLogs.count()).toBe(0);
  });
});

describe('purgeDeleted', () => {
  it('hard-deletes only rows older than the cutoff', async () => {
    const oldPond = await makePond('Old');
    const recentPond = await makePond('Recent');
    const live = await makePond('Live');
    const oldCatch = await makeCatch(live.id);
    const recentCatch = await makeCatch(live.id);
    const liveCatch = await makeCatch(live.id);
    await db.photos.put({ id: 'ph-old', catchId: oldCatch.id, blob: new Blob(['x']), width: 1, height: 1, bytes: 1, pending: 1 });

    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await db.ponds.update(oldPond.id, { deletedAt: old });
    await db.catches.update(oldCatch.id, { deletedAt: old });
    await repo.softDeletePond(recentPond.id);
    await repo.softDeleteCatch(recentCatch.id);
    await db.feedingLogs.put({ id: 'fl-old', pondId: live.id, startedOn: '2026-01-01', createdAt: old, updatedAt: old, deletedAt: old, pending: 1 });

    const res = await repo.purgeDeleted(30);
    expect(res).toEqual({ ponds: 1, catches: 1, feedingLogs: 1 });

    expect(await db.ponds.get(oldPond.id)).toBeUndefined();
    expect(await db.ponds.get(recentPond.id)).toBeDefined();
    expect(await db.catches.get(oldCatch.id)).toBeUndefined();
    expect(await db.catches.get(recentCatch.id)).toBeDefined();
    expect(await db.catches.get(liveCatch.id)).toBeDefined();
    expect(await db.photos.count()).toBe(0);
    expect(await db.feedingLogs.count()).toBe(0);

    // Running again with nothing old is a no-op.
    expect(await repo.purgeDeleted(30)).toEqual({ ponds: 0, catches: 0, feedingLogs: 0 });
  });
});
