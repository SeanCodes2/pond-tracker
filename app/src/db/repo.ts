import type { Catch, FeedingLog, Outcome, Pond, Settings, SpeciesCode } from '@pond-tracker/shared';
import { DEFAULT_SETTINGS, relativeWeight, standardWeightLb } from '@pond-tracker/shared';
import Dexie from 'dexie';
import { db, type CatchRow, type FeedingLogRow, type PhotoRow, type PondRow, type PondTrackerDB } from './db';
import { resizeImage } from '../lib/image';

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

  async function restoreCatch(id: string): Promise<void> {
    await database.catches.update(id, { deletedAt: undefined, updatedAt: now(), pending: 1 });
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
    await database.settings.put(next);
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

  return {
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
  };
}

export type Repo = ReturnType<typeof createRepo>;
export const repo: Repo = createRepo(db);
