import type { Catch, FeedingLog, Outcome, Pond, Settings, SpeciesCode } from '@pond-tracker/shared';
import { DEFAULT_SETTINGS, relativeWeight, standardWeightLb } from '@pond-tracker/shared';
import Dexie from 'dexie';
import { db, type CatchRow, type FeedingLogRow, type PhotoRow, type PondRow, type PondTrackerDB } from './db';
import { resizeImage } from '../lib/image';
import { SAMPLE_POND_NAME, generateSampleCatches, generateSampleFeedingLogs } from './sample';

const now = (): string => new Date().toISOString();
const newId = (): string => crypto.randomUUID();

/** A repository bound to a database instance so tests can use an isolated DB. */
export function createRepo(database: PondTrackerDB) {
  // ---------- ponds ----------
  async function listPonds(): Promise<PondRow[]> {
    const rows = await database.ponds.filter((p) => !p.deletedAt).toArray();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getPond(id: string): Promise<PondRow | undefined> {
    const p = await database.ponds.get(id);
    return p && !p.deletedAt ? p : undefined;
  }

  type PondInput = Omit<Pond, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string };

  async function savePond(input: PondInput): Promise<PondRow> {
    const ts = now();
    const existing = input.id ? await database.ponds.get(input.id) : undefined;
    const row: PondRow = {
      ...existing,
      ...input,
      id: input.id ?? newId(),
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      pending: 1,
    };
    await database.ponds.put(row);
    return row;
  }

  async function softDeletePond(id: string): Promise<void> {
    const ts = now();
    await database.ponds.update(id, { deletedAt: ts, updatedAt: ts, pending: 1 });
  }

  // ---------- catches ----------
  interface AddCatchInput {
    pondId: string;
    speciesId: SpeciesCode;
    lengthIn: number;
    weightLb: number;
    outcome: Outcome;
    caughtAt?: string;
    lat?: number;
    lon?: number;
    waterTempF?: number;
    airTempF?: number;
    lure?: string;
    notes?: string;
  }

  function computeWr(speciesId: SpeciesCode, lengthIn: number, weightLb: number): { wsLb: number; wr: number } {
    const wsLb = standardWeightLb(speciesId, lengthIn);
    const wr = relativeWeight(speciesId, lengthIn, weightLb);
    return { wsLb, wr };
  }

  async function addCatch(input: AddCatchInput): Promise<CatchRow> {
    const ts = now();
    const row: CatchRow = {
      ...input,
      ...computeWr(input.speciesId, input.lengthIn, input.weightLb),
      id: newId(),
      caughtAt: input.caughtAt ?? ts,
      createdAt: ts,
      updatedAt: ts,
      pending: 1,
    };
    await database.catches.put(row);
    return row;
  }

  type CatchPatch = Partial<Omit<Catch, 'id' | 'createdAt' | 'updatedAt' | 'wsLb' | 'wr'>>;

  async function updateCatch(id: string, patch: CatchPatch): Promise<CatchRow | undefined> {
    const existing = await database.catches.get(id);
    if (!existing) return undefined;
    const merged: CatchRow = { ...existing, ...patch, updatedAt: now(), pending: 1 };
    const recomputed = { ...merged, ...computeWr(merged.speciesId, merged.lengthIn, merged.weightLb) };
    await database.catches.put(recomputed);
    return recomputed;
  }

  async function softDeleteCatch(id: string): Promise<void> {
    const ts = now();
    await database.catches.update(id, { deletedAt: ts, updatedAt: ts, pending: 1 });
  }

  /** Restores a catch. If its pond is also soft-deleted the pond is restored too (pondRestored = true). */
  async function restoreCatch(id: string): Promise<{ pondRestored: boolean }> {
    return database.transaction('rw', database.catches, database.ponds, async () => {
      const ts = now();
      const c = await database.catches.get(id);
      if (!c) return { pondRestored: false };
      await database.catches.update(id, { deletedAt: undefined, updatedAt: ts, pending: 1 });
      const pond = await database.ponds.get(c.pondId);
      if (pond?.deletedAt) {
        await database.ponds.update(pond.id, { deletedAt: undefined, updatedAt: ts, pending: 1 });
        return { pondRestored: true };
      }
      return { pondRestored: false };
    });
  }

  async function getCatch(id: string): Promise<CatchRow | undefined> {
    return database.catches.get(id);
  }

  interface ListCatchesOpts {
    speciesId?: SpeciesCode;
    limit?: number;
    includeDeleted?: boolean;
  }

  /** Newest first. pondId undefined = all ponds. */
  async function listCatches(pondId: string | undefined, opts: ListCatchesOpts = {}): Promise<CatchRow[]> {
    const coll = pondId
      ? database.catches.where('[pondId+caughtAt]').between([pondId, Dexie.minKey], [pondId, Dexie.maxKey], true, true)
      : database.catches.orderBy('caughtAt');
    let rows = await coll.reverse().toArray();
    if (!opts.includeDeleted) rows = rows.filter((c) => !c.deletedAt);
    if (opts.speciesId) rows = rows.filter((c) => c.speciesId === opts.speciesId);
    if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async function countCatches(pondId: string): Promise<number> {
    return database.catches
      .where('pondId')
      .equals(pondId)
      .filter((c) => !c.deletedAt)
      .count();
  }

  // ---------- settings ----------
  async function getSettings(): Promise<Settings> {
    return (await database.settings.get('settings')) ?? DEFAULT_SETTINGS;
  }

  async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
    const current = await getSettings();
    const next: Settings = { ...current, ...patch, id: 'settings', updatedAt: now() };
    await database.settings.put({ ...next, pending: 1 });
    return next;
  }

  // ---------- photos ----------
  async function savePhoto(catchId: string, blob: Blob): Promise<PhotoRow> {
    const resized = await resizeImage(blob, 1200, 0.8);
    const existing = await database.photos.where('catchId').equals(catchId).first();
    const row: PhotoRow = {
      id: existing?.id ?? newId(),
      catchId,
      blob: resized.blob,
      width: resized.width,
      height: resized.height,
      bytes: resized.blob.size,
      updatedAt: now(),
      pending: 1,
    };
    await database.transaction('rw', database.photos, database.catches, async () => {
      await database.photos.put(row);
      await database.catches.update(catchId, { photoId: row.id, updatedAt: now(), pending: 1 });
    });
    return row;
  }

  async function getPhoto(id: string): Promise<PhotoRow | undefined> {
    return database.photos.get(id);
  }

  async function deletePhoto(catchId: string): Promise<void> {
    await database.transaction('rw', database.photos, database.catches, async () => {
      await database.photos.where('catchId').equals(catchId).delete();
      await database.catches.update(catchId, { photoId: undefined, updatedAt: now(), pending: 1 });
    });
  }

  // ---------- feeding logs ----------
  type FeedingLogInput = Omit<FeedingLog, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: string };

  async function listFeedingLogs(pondId: string): Promise<FeedingLogRow[]> {
    const rows = await database.feedingLogs.where('pondId').equals(pondId).toArray();
    return rows.filter((f) => !f.deletedAt).sort((a, b) => b.startedOn.localeCompare(a.startedOn));
  }

  async function saveFeedingLog(input: FeedingLogInput): Promise<FeedingLogRow> {
    const ts = now();
    const existing = input.id ? await database.feedingLogs.get(input.id) : undefined;
    const row: FeedingLogRow = {
      ...existing,
      ...input,
      id: input.id ?? newId(),
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      pending: 1,
    };
    await database.feedingLogs.put(row);
    return row;
  }

  async function softDeleteFeedingLog(id: string): Promise<void> {
    const ts = now();
    await database.feedingLogs.update(id, { deletedAt: ts, updatedAt: ts, pending: 1 });
  }

  /** Local calendar date as YYYY-MM-DD (feeding periods are whole days in pond time). */
  function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayBefore(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** The feeder schedule currently running (open-ended), if any. */
  async function currentFeederSchedule(pondId: string): Promise<FeedingLogRow | undefined> {
    const rows = await listFeedingLogs(pondId);
    return rows.find((f) => f.kind !== 'fill' && !f.endedOn);
  }

  interface ScheduleInput {
    feedTimes: string[];
    secondsPerFeed?: number;
    feederModel?: string;
    pelletSizeMm?: number;
    notes?: string;
    /** YYYY-MM-DD the new settings take effect; defaults to today. */
    startedOn?: string;
  }

  /**
   * Start (or change) the feeder schedule: closes the running period the day before the new
   * one starts, so chart shading follows exactly when each setting was in effect.
   */
  async function startFeederSchedule(pondId: string, input: ScheduleInput): Promise<FeedingLogRow> {
    const startedOn = input.startedOn ?? today();
    const running = await currentFeederSchedule(pondId);
    if (running) {
      // Changing settings the same day it started: just edit that period.
      if (running.startedOn >= startedOn) {
        return saveFeedingLog({ ...running, ...input, kind: 'schedule', feedsPerDay: input.feedTimes.length, startedOn: running.startedOn });
      }
      await saveFeedingLog({ ...running, endedOn: dayBefore(startedOn) });
    }
    return saveFeedingLog({
      pondId,
      kind: 'schedule',
      startedOn,
      feedTimes: [...input.feedTimes].sort(),
      feedsPerDay: input.feedTimes.length,
      secondsPerFeed: input.secondsPerFeed,
      feederModel: input.feederModel,
      pelletSizeMm: input.pelletSizeMm,
      notes: input.notes,
    });
  }

  /** Turn the feeder off: ends the running schedule today. */
  async function stopFeeder(pondId: string, endedOn = today()): Promise<void> {
    const running = await currentFeederSchedule(pondId);
    if (running) await saveFeedingLog({ ...running, endedOn: endedOn < running.startedOn ? running.startedOn : endedOn });
  }

  /** Record a hopper fill. */
  async function logFeederFill(pondId: string, lbs?: number, on = today()): Promise<FeedingLogRow> {
    return saveFeedingLog({ pondId, kind: 'fill', startedOn: on, endedOn: on, filledOn: on, lbsPerFill: lbs });
  }

  // ---------- sample data ----------
  async function findSamplePond(): Promise<PondRow | undefined> {
    return database.ponds.filter((p) => p.sample === 1 && !p.deletedAt).first();
  }

  /** Live-query friendly counts of seeded demo rows. */
  async function countSampleData(): Promise<{ ponds: number; catches: number }> {
    const [ponds, catches] = await Promise.all([
      database.ponds.filter((p) => p.sample === 1 && !p.deletedAt).count(),
      database.catches.filter((c) => c.sample === 1 && !c.deletedAt).count(),
    ]);
    return { ponds, catches };
  }

  /**
   * Seed a deterministic demo pond with ~80 catches and two feeding logs.
   * Idempotent: if a sample pond already exists it is returned untouched.
   */
  async function seedSampleData(): Promise<{ pondId: string }> {
    const existing = await findSamplePond();
    if (existing) return { pondId: existing.id };

    const ts = now();
    const year = new Date().getFullYear();
    const pondId = newId();
    const pond: PondRow = {
      id: pondId,
      name: SAMPLE_POND_NAME,
      acres: 3.2,
      lat: 38.81,
      lon: -94.93,
      geofenceM: 150,
      cullSlotMinIn: 8,
      cullSlotMaxIn: 13,
      wrThresholds: { ...DEFAULT_SETTINGS.defaultThresholds },
      notes: 'Demo data — remove from Settings',
      createdAt: ts,
      updatedAt: ts,
      pending: 1,
      sample: 1,
    };
    const catches: CatchRow[] = generateSampleCatches(year).map((c) => ({
      ...c,
      ...computeWr(c.speciesId, c.lengthIn, c.weightLb),
      id: newId(),
      pondId,
      createdAt: ts,
      updatedAt: ts,
      pending: 1,
      sample: 1,
    }));
    const feedingLogs: FeedingLogRow[] = generateSampleFeedingLogs(year).map((f) => ({
      ...f,
      id: newId(),
      pondId,
      createdAt: ts,
      updatedAt: ts,
      pending: 1,
      sample: 1,
    }));

    await database.transaction('rw', database.ponds, database.catches, database.feedingLogs, async () => {
      await database.ponds.put(pond);
      await database.catches.bulkPut(catches);
      await database.feedingLogs.bulkPut(feedingLogs);
    });
    return { pondId };
  }

  /** Hard-delete every row flagged sample: 1 (and any photos attached to sample catches). */
  async function removeSampleData(): Promise<void> {
    await database.transaction('rw', database.ponds, database.catches, database.feedingLogs, database.photos, async () => {
      const sampleCatchIds = await database.catches.filter((c) => c.sample === 1).primaryKeys();
      if (sampleCatchIds.length) {
        await database.photos.where('catchId').anyOf(sampleCatchIds).delete();
      }
      await database.catches.filter((c) => c.sample === 1).delete();
      await database.feedingLogs.filter((f) => f.sample === 1).delete();
      await database.ponds.filter((p) => p.sample === 1).delete();
    });
  }

  // ---------- records management (soft delete / restore / purge) ----------
  interface CascadeResult {
    /** Timestamp stamped on every row in this cascade; pass it to restorePondCascade for an exact undo. */
    deletedAt: string;
    catches: number;
    feedingLogs: number;
  }

  /** Soft-deletes a pond together with its live catches and feeding logs, all stamped with one timestamp. */
  async function softDeletePondCascade(pondId: string): Promise<CascadeResult> {
    const ts = now();
    return database.transaction('rw', database.ponds, database.catches, database.feedingLogs, async () => {
      const catches = await database.catches.where('pondId').equals(pondId).filter((c) => !c.deletedAt).primaryKeys();
      const logs = await database.feedingLogs.where('pondId').equals(pondId).filter((f) => !f.deletedAt).primaryKeys();
      const stamp = { deletedAt: ts, updatedAt: ts, pending: 1 as const };
      await database.ponds.update(pondId, stamp);
      if (catches.length) await database.catches.where('id').anyOf(catches).modify(stamp);
      if (logs.length) await database.feedingLogs.where('id').anyOf(logs).modify(stamp);
      return { deletedAt: ts, catches: catches.length, feedingLogs: logs.length };
    });
  }

  /**
   * Restores a pond plus the catches/feeding logs deleted in the same cascade.
   * `deletedAt` defaults to the pond's own deletedAt, so rows deleted earlier on their own stay deleted.
   */
  async function restorePondCascade(pondId: string, deletedAt?: string): Promise<CascadeResult> {
    const ts = now();
    return database.transaction('rw', database.ponds, database.catches, database.feedingLogs, async () => {
      const pond = await database.ponds.get(pondId);
      const stampToMatch = deletedAt ?? pond?.deletedAt;
      const restore = { deletedAt: undefined, updatedAt: ts, pending: 1 as const };
      if (pond) await database.ponds.update(pondId, restore);
      if (!stampToMatch) return { deletedAt: '', catches: 0, feedingLogs: 0 };
      const catches = await database.catches
        .where('pondId')
        .equals(pondId)
        .filter((c) => c.deletedAt === stampToMatch)
        .modify(restore);
      const feedingLogs = await database.feedingLogs
        .where('pondId')
        .equals(pondId)
        .filter((f) => f.deletedAt === stampToMatch)
        .modify(restore);
      return { deletedAt: stampToMatch, catches, feedingLogs };
    });
  }

  async function softDeleteCatches(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const ts = now();
    return database.catches
      .where('id')
      .anyOf(ids)
      .filter((c) => !c.deletedAt)
      .modify({ deletedAt: ts, updatedAt: ts, pending: 1 });
  }

  async function restoreCatches(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const ts = now();
    return database.catches.where('id').anyOf(ids).modify({ deletedAt: undefined, updatedAt: ts, pending: 1 });
  }

  const byDeletedDesc = <T extends { deletedAt?: string }>(a: T, b: T) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');

  /** Soft-deleted ponds, newest deletion first. */
  async function listDeletedPonds(): Promise<PondRow[]> {
    const rows = await database.ponds.filter((p) => !!p.deletedAt).toArray();
    return rows.sort(byDeletedDesc);
  }

  /** Soft-deleted catches, newest deletion first. */
  async function listDeletedCatches(): Promise<CatchRow[]> {
    const rows = await database.catches.filter((c) => !!c.deletedAt).toArray();
    return rows.sort(byDeletedDesc);
  }

  /** Permanently removes catches and their photos. */
  async function hardDeleteCatches(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return database.transaction('rw', database.catches, database.photos, async () => {
      await database.photos.where('catchId').anyOf(ids).delete();
      return database.catches.where('id').anyOf(ids).delete();
    });
  }

  /** Permanently removes a pond with every catch (and photo) and feeding log that belongs to it. */
  async function hardDeletePond(pondId: string): Promise<{ catches: number; feedingLogs: number }> {
    return database.transaction('rw', database.ponds, database.catches, database.photos, database.feedingLogs, async () => {
      const catchIds = await database.catches.where('pondId').equals(pondId).primaryKeys();
      if (catchIds.length) await database.photos.where('catchId').anyOf(catchIds).delete();
      const catches = await database.catches.where('pondId').equals(pondId).delete();
      const feedingLogs = await database.feedingLogs.where('pondId').equals(pondId).delete();
      await database.ponds.delete(pondId);
      return { catches, feedingLogs };
    });
  }

  /** Hard-deletes rows that were soft-deleted more than `olderThanDays` ago. Call once at app start. */
  async function purgeDeleted(olderThanDays = 30): Promise<{ ponds: number; catches: number; feedingLogs: number }> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const old = (r: { deletedAt?: string }) => !!r.deletedAt && r.deletedAt < cutoff;
    return database.transaction('rw', database.ponds, database.catches, database.photos, database.feedingLogs, async () => {
      const pondIds = await database.ponds.filter(old).primaryKeys();
      let catches = 0;
      let feedingLogs = 0;
      for (const id of pondIds) {
        const r = await hardDeletePond(id);
        catches += r.catches;
        feedingLogs += r.feedingLogs;
      }
      const catchIds = await database.catches.filter(old).primaryKeys();
      catches += await hardDeleteCatches(catchIds);
      const logIds = await database.feedingLogs.filter(old).primaryKeys();
      if (logIds.length) feedingLogs += await database.feedingLogs.where('id').anyOf(logIds).delete();
      return { ponds: pondIds.length, catches, feedingLogs };
    });
  }

  return {
    softDeletePondCascade,
    restorePondCascade,
    softDeleteCatches,
    restoreCatches,
    listDeletedPonds,
    listDeletedCatches,
    hardDeleteCatches,
    hardDeletePond,
    purgeDeleted,
    listPonds,
    getPond,
    savePond,
    softDeletePond,
    addCatch,
    updateCatch,
    softDeleteCatch,
    restoreCatch,
    getCatch,
    listCatches,
    countCatches,
    getSettings,
    saveSettings,
    savePhoto,
    getPhoto,
    deletePhoto,
    listFeedingLogs,
    saveFeedingLog,
    softDeleteFeedingLog,
    currentFeederSchedule,
    startFeederSchedule,
    stopFeeder,
    logFeederFill,
    countSampleData,
    seedSampleData,
    removeSampleData,
  };
}

export type Repo = ReturnType<typeof createRepo>;
export const repo: Repo = createRepo(db);
