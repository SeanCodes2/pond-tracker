import Dexie, { type EntityTable } from 'dexie';
import type { Catch, FeedingLog, Pond, Settings } from '@pond-tracker/shared';
import { DEFAULT_SETTINGS } from '@pond-tracker/shared';

/** 0 = synced, 1 = waiting to be pushed by the sync engine. Stored as a number so Dexie can index it. */
export type Pending = 0 | 1;

/** Rows created by the sample-data seeder carry sample: 1 so they can be removed in one go. Not indexed. */
export interface SampleFlag {
  sample?: 1;
}

export type PondRow = Pond & { pending: Pending } & SampleFlag;
export type CatchRow = Catch & { pending: Pending } & SampleFlag;
export type FeedingLogRow = FeedingLog & { pending: Pending } & SampleFlag;

export interface PhotoRow {
  id: string;
  catchId: string;
  /** Absent for photos pulled from the cloud: the image is then served by GET /api/photos/{id}. */
  blob?: Blob;
  width: number;
  height: number;
  bytes: number;
  /** Change marker for sync (rows written before sync existed may lack it). */
  updatedAt?: string;
  pending: Pending;
}

/**
 * The settings singleton. `pending` is undefined for the seeded defaults so a fresh device
 * never pushes its defaults over settings already in the cloud.
 */
export type SettingsRow = Settings & { pending?: Pending };

export type SyncStatus = 'ok' | 'offline' | 'signed-out' | 'error';

/** Single row, id 'sync'. */
export interface SyncStateRow {
  id: string;
  /** serverTime from the last applied /api/sync response; the next request's `since`. */
  lastServerTime?: string;
  /** Last successful sync (device clock). */
  lastSyncAt?: string;
  lastStatus?: SyncStatus;
  lastError?: string;
  /** Photos skipped on the last run because Wi-Fi-only upload is on and the phone is on cellular. */
  photosWaitingForWifi?: number;
}

export class PondTrackerDB extends Dexie {
  ponds!: EntityTable<PondRow, 'id'>;
  catches!: EntityTable<CatchRow, 'id'>;
  feedingLogs!: EntityTable<FeedingLogRow, 'id'>;
  photos!: EntityTable<PhotoRow, 'id'>;
  settings!: EntityTable<SettingsRow, 'id'>;
  syncState!: EntityTable<SyncStateRow, 'id'>;

  constructor(name = 'PondTrackerDB') {
    super(name);
    this.version(1).stores({
      ponds: 'id, name, updatedAt, pending',
      catches: 'id, pondId, speciesId, caughtAt, [pondId+caughtAt], [pondId+speciesId], updatedAt, pending',
      feedingLogs: 'id, pondId, updatedAt, pending',
      photos: 'id, catchId, pending',
      settings: 'id',
      syncState: 'id',
    });
  }
}

export const db = new PondTrackerDB();

/** Seeds settings on first run and asks the browser for persistent storage. Safe to call repeatedly. */
export async function initDb(database: PondTrackerDB = db): Promise<void> {
  const existing = await database.settings.get('settings');
  if (!existing) {
    await database.settings.put({ ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() });
  }
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      await navigator.storage.persist();
    } catch {
      // Not fatal: the app still works with best-effort storage.
    }
  }
}
