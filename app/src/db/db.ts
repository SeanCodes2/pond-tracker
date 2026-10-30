import Dexie, { type EntityTable } from 'dexie';
import type { Catch, FeedingLog, Pond, Settings } from '@pond-tracker/shared';
import { DEFAULT_SETTINGS } from '@pond-tracker/shared';

/** 0 = synced, 1 = waiting for a future sync queue. Stored as a number so Dexie can index it. */
export type Pending = 0 | 1;

export type PondRow = Pond & { pending: Pending };
export type CatchRow = Catch & { pending: Pending };
export type FeedingLogRow = FeedingLog & { pending: Pending };

export interface PhotoRow {
  id: string;
  catchId: string;
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  pending: Pending;
}

export interface SyncStateRow {
  id: string;
  lastSyncedAt?: string;
  cursor?: string;
}

export class PondTrackerDB extends Dexie {
  ponds!: EntityTable<PondRow, 'id'>;
  catches!: EntityTable<CatchRow, 'id'>;
  feedingLogs!: EntityTable<FeedingLogRow, 'id'>;
  photos!: EntityTable<PhotoRow, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
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
