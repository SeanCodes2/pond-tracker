import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_SLOT, DEFAULT_THRESHOLDS, standardWeightLb } from '@pond-tracker/shared';
import { PondTrackerDB, initDb } from '../db';
import { createRepo, type Repo } from '../repo';

let db: PondTrackerDB;
let repo: Repo;
let n = 0;

beforeEach(async () => {
  db = new PondTrackerDB(`test-${++n}`);
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

describe('repo', () => {
  it('seeds settings on first run', async () => {
    const s = await repo.getSettings();
    expect(s.id).toBe('settings');
    expect(s.weightUnits).toBe(DEFAULT_SETTINGS.weightUnits);
    expect(s.lengthStepIn).toBe(DEFAULT_SETTINGS.lengthStepIn);
  });

  it('addCatch computes Ws and Wr and stamps metadata', async () => {
    const pond = await makePond();
    const c = await repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 14, weightLb: 1.6, outcome: 'released' });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.pending).toBe(1);
    expect(c.wsLb).toBeCloseTo(standardWeightLb('LMB', 14), 6);
    expect(c.wr).toBeCloseTo((100 * 1.6) / c.wsLb, 6);
    expect(c.createdAt).toBe(c.updatedAt);
    expect(c.caughtAt).toBe(c.createdAt);
  });

  it('lists catches newest first per pond and hides soft-deleted ones', async () => {
    const a = await makePond('A');
    const b = await makePond('B');
    const c1 = await repo.addCatch({ pondId: a.id, speciesId: 'LMB', lengthIn: 10, weightLb: 0.6, outcome: 'kept', caughtAt: '2026-05-01T10:00:00.000Z' });
    const c2 = await repo.addCatch({ pondId: a.id, speciesId: 'BLG', lengthIn: 7, weightLb: 0.3, outcome: 'released', caughtAt: '2026-05-02T10:00:00.000Z' });
    await repo.addCatch({ pondId: b.id, speciesId: 'LMB', lengthIn: 16, weightLb: 2.4, outcome: 'released', caughtAt: '2026-05-03T10:00:00.000Z' });

    const listA = await repo.listCatches(a.id);
    expect(listA.map((c) => c.id)).toEqual([c2.id, c1.id]);

    const all = await repo.listCatches(undefined);
    expect(all).toHaveLength(3);
    expect(all[0]?.pondId).toBe(b.id);

    await repo.softDeleteCatch(c2.id);
    expect((await repo.listCatches(a.id)).map((c) => c.id)).toEqual([c1.id]);
    expect(await repo.countCatches(a.id)).toBe(1);

    await repo.restoreCatch(c2.id);
    expect(await repo.listCatches(a.id)).toHaveLength(2);
    expect(await repo.listCatches(a.id, { speciesId: 'BLG' })).toHaveLength(1);
  });

  it('updateCatch recomputes Wr when length/weight change', async () => {
    const pond = await makePond();
    const c = await repo.addCatch({ pondId: pond.id, speciesId: 'LMB', lengthIn: 12, weightLb: 1, outcome: 'kept' });
    const u = await repo.updateCatch(c.id, { lengthIn: 15, weightLb: 2 });
    expect(u).toBeDefined();
    expect(u?.wsLb).toBeCloseTo(standardWeightLb('LMB', 15), 6);
    expect(u?.wr).toBeCloseTo(200 / (u?.wsLb ?? 1), 6);
    expect((u?.updatedAt ?? '') >= c.updatedAt).toBe(true);
  });

  it('soft-deleting a pond hides it from listPonds and getPond', async () => {
    const p = await makePond('Gone');
    await makePond('Stays');
    await repo.softDeletePond(p.id);
    expect((await repo.listPonds()).map((x) => x.name)).toEqual(['Stays']);
    expect(await repo.getPond(p.id)).toBeUndefined();
  });

  it('saveSettings merges a patch', async () => {
    const s = await repo.saveSettings({ weightUnits: 'lbsOz', requireWeight: false });
    expect(s.weightUnits).toBe('lbsOz');
    expect(s.requireWeight).toBe(false);
    expect(s.lengthStepIn).toBe(DEFAULT_SETTINGS.lengthStepIn);
  });
});
