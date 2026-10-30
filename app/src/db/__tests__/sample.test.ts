import { beforeEach, describe, expect, it } from 'vitest';
import { PondTrackerDB, initDb } from '../db';
import { createRepo, type Repo } from '../repo';
import { generateSampleCatches } from '../sample';

let db: PondTrackerDB;
let repo: Repo;
let n = 0;

beforeEach(async () => {
  db = new PondTrackerDB(`sample-test-${++n}`);
  repo = createRepo(db);
  await initDb(db);
});

describe('sample data', () => {
  it('generator is deterministic and tells the intended story', () => {
    const a = generateSampleCatches(2026);
    const b = generateSampleCatches(2026);
    expect(a).toEqual(b);
    const bass = a.filter((c) => c.speciesId === 'LMB');
    const bluegill = a.filter((c) => c.speciesId === 'BLG');
    expect(bass.length).toBe(45);
    expect(bluegill.length).toBe(35);
    for (const c of a) {
      expect(c.lengthIn * 4).toBeCloseTo(Math.round(c.lengthIn * 4), 9);
      expect(c.weightLb).toBeGreaterThan(0);
      expect(new Date(c.caughtAt).getFullYear()).toBe(2026);
    }
    const months = new Set(a.map((c) => new Date(c.caughtAt).getMonth()));
    expect(Math.min(...months)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...months)).toBeLessThanOrEqual(9);
  });

  it('seeds rows flagged sample and removes them all', async () => {
    const { pondId } = await repo.seedSampleData();
    const pond = await repo.getPond(pondId);
    expect(pond?.sample).toBe(1);
    expect(pond?.name).toBe('Sample pond');

    const catches = await repo.listCatches(pondId);
    const feeds = await repo.listFeedingLogs(pondId);
    expect(catches.length).toBeGreaterThan(0);
    expect(feeds.length).toBe(2);
    expect(catches.every((c) => c.sample === 1 && c.wr > 0 && c.wsLb > 0)).toBe(true);
    expect(feeds.every((f) => f.sample === 1)).toBe(true);

    const counts = await repo.countSampleData();
    expect(counts.ponds).toBe(1);
    expect(counts.catches).toBe(catches.length);

    // Seeding again is a no-op that returns the same pond.
    const again = await repo.seedSampleData();
    expect(again.pondId).toBe(pondId);
    expect((await repo.listPonds()).length).toBe(1);

    await repo.removeSampleData();
    expect(await repo.getPond(pondId)).toBeUndefined();
    expect(await db.catches.count()).toBe(0);
    expect(await db.feedingLogs.count()).toBe(0);
    expect(await repo.countSampleData()).toEqual({ ponds: 0, catches: 0 });
  });

  it('leaves real data alone when removing sample data', async () => {
    const real = await repo.savePond({ name: 'Mine', geofenceM: 100, cullSlotMinIn: 8, cullSlotMaxIn: 13, wrThresholds: { low: 85, ok: 95, high: 110 } });
    await repo.addCatch({ pondId: real.id, speciesId: 'LMB', lengthIn: 14, weightLb: 1.6, outcome: 'released' });
    await repo.seedSampleData();
    await repo.removeSampleData();
    expect(await repo.getPond(real.id)).toBeDefined();
    expect(await db.catches.count()).toBe(1);
  });
});
