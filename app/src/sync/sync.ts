/**
 * Best-effort cloud sync. IndexedDB on the phone stays the source of truth: every local write
 * sets pending: 1, a sync run pushes pending rows to POST /api/sync, clears `pending` on what
 * the server accepted, and applies the server's changes with last-writer-wins on `updatedAt`.
 * Any failure leaves rows pending for the next run; the app never waits on sync.
 */
import type { Settings } from '@pond-tracker/shared';
import { DEFAULT_SETTINGS } from '@pond-tracker/shared';
import { db, type PhotoRow, type PondTrackerDB, type SyncStateRow, type SyncStatus } from '../db/db';

export type SyncDocType = 'pond' | 'catch' | 'feedingLog' | 'settings' | 'photo';

/** Wire shape; mirrors api/src/types.ts (kept local so the app doesn't import the API). */
export interface SyncDoc {
  id: string;
  type: SyncDocType;
  updatedAt: string;
  deletedAt?: string;
  [k: string]: unknown;
}

interface SyncResponse {
  serverChanges: SyncDoc[];
  serverTime: string;
}

interface UploadUrlResponse {
  photoId: string;
  blobName: string;
  sasUrl: string;
  expiresOn: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  photosUploaded: number;
  status: SyncStatus;
  error?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SYNC_STATE_ID = 'sync';
/** Server allows 500; stay well under so a request body stays small on a weak signal. */
const BATCH_SIZE = 200;
/** Fields that are device-local or server-owned and never go into (or come out of) a row. */
const LOCAL_ONLY = ['pending', 'sample', 'blob'] as const;
const SERVER_ONLY = ['type', 'userId', 'serverUpdatedAt'] as const;

type RecordTable = 'ponds' | 'catches' | 'feedingLogs' | 'settings' | 'photos';
const TABLE_FOR: Record<SyncDocType, RecordTable> = {
  pond: 'ponds',
  catch: 'catches',
  feedingLog: 'feedingLogs',
  settings: 'settings',
  photo: 'photos',
};

/** A row we pushed, with the updatedAt we pushed, so pending is cleared only if it hasn't changed since. */
interface PushedRef {
  table: RecordTable;
  id: string;
  updatedAt: string | undefined;
}
interface Outgoing {
  doc: SyncDoc;
  ref: PushedRef;
}

/** Thrown for 401/403 (signed out / not invited) and for no network, so the run can stop cleanly. */
class StopSync extends Error {
  constructor(readonly status: Exclude<SyncStatus, 'ok'>, message: string) {
    super(message);
  }
}

function omit(row: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!keys.includes(k) && v !== undefined) out[k] = v;
  return out;
}

/** Only an explicit 'cellular' counts as "not Wi-Fi"; a missing Network Information API means unknown → allowed. */
export function onCellular(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return conn?.type === 'cellular';
}

function isDefaultSettings(s: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
    .filter((k) => k !== 'id' && k !== 'updatedAt')
    .every((k) => JSON.stringify(s[k]) === JSON.stringify(DEFAULT_SETTINGS[k]));
}

/** Ids of sample catches; their photos never sync, like the sample rows themselves. */
async function sampleCatchIds(database: PondTrackerDB): Promise<Set<string>> {
  return new Set(await database.catches.filter((c) => c.sample === 1).primaryKeys());
}

/** Pending counts for the Settings card (sample data excluded, matching what a sync would push). */
export async function countPending(database: PondTrackerDB = db): Promise<{ records: number; photos: number }> {
  const notSample = (r: { sample?: 1 }) => r.sample !== 1;
  const [ponds, catches, logs, settings, samples] = await Promise.all([
    database.ponds.where('pending').equals(1).filter(notSample).count(),
    database.catches.where('pending').equals(1).filter(notSample).count(),
    database.feedingLogs.where('pending').equals(1).filter(notSample).count(),
    database.settings.get('settings'),
    sampleCatchIds(database),
  ]);
  const photos = await database.photos
    .where('pending')
    .equals(1)
    .filter((p) => !samples.has(p.catchId))
    .count();
  return { records: ponds + catches + logs + (settings?.pending === 1 ? 1 : 0), photos };
}

export function createSyncEngine(database: PondTrackerDB, fetchImpl: FetchLike = (i, init) => fetch(i, init)) {
  async function api<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new StopSync('offline', e instanceof Error ? e.message : 'Network error');
    }
    if (res.status === 401 || res.status === 403) throw new StopSync('signed-out', `HTTP ${res.status}`);
    if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Pending non-sample record rows mapped to SyncDocs. */
  async function collectRecords(firstSync: boolean): Promise<Outgoing[]> {
    const out: Outgoing[] = [];
    const add = (table: RecordTable, type: SyncDocType, row: { id: string; updatedAt: string; sample?: 1 }) => {
      if (row.sample === 1) return;
      out.push({ doc: { ...omit(row, LOCAL_ONLY), type, id: row.id, updatedAt: row.updatedAt }, ref: { table, id: row.id, updatedAt: row.updatedAt } });
    };
    for (const r of await database.ponds.where('pending').equals(1).toArray()) add('ponds', 'pond', r);
    for (const r of await database.catches.where('pending').equals(1).toArray()) add('catches', 'catch', r);
    for (const r of await database.feedingLogs.where('pending').equals(1).toArray()) add('feedingLogs', 'feedingLog', r);
    const settings = await database.settings.get('settings');
    // Installs from before sync have pending undefined even if the user changed settings; on the
    // first sync push them if they differ from the defaults (the server's LWW still decides).
    if (settings?.pending === 1 || (firstSync && settings && settings.pending === undefined && !isDefaultSettings(settings))) {
      add('settings', 'settings', settings);
    }
    return out;
  }

  /** Uploads pending photo blobs; returns the photo docs to push for the ones that made it. */
  async function uploadPhotos(): Promise<{ docs: Outgoing[]; uploaded: number; waitingForWifi: number }> {
    const pending = await database.photos.where('pending').equals(1).toArray();
    const samples = await sampleCatchIds(database);
    const eligible = pending.filter((p) => !samples.has(p.catchId) && p.blob);
    const settings = await database.settings.get('settings');
    if (eligible.length && settings?.wifiOnlyPhotoSync && onCellular()) {
      return { docs: [], uploaded: 0, waitingForWifi: eligible.length };
    }
    const docs: Outgoing[] = [];
    for (const p of eligible) {
      let updatedAt = p.updatedAt;
      if (!updatedAt) {
        // Photos saved before sync existed have no change marker. Stamp one locally first, or the
        // echo of our own push would look "newer" than the local row and replace it without its blob.
        updatedAt = new Date().toISOString();
        await database.photos.update(p.id, { updatedAt });
      }
      if (await uploadOne(p)) {
        docs.push({
          doc: { type: 'photo', id: p.id, catchId: p.catchId, width: p.width, height: p.height, bytes: p.bytes, updatedAt },
          ref: { table: 'photos', id: p.id, updatedAt },
        });
      }
    }
    return { docs, uploaded: docs.length, waitingForWifi: 0 };
  }

  /** false = this photo failed and stays pending; StopSync (auth/offline) propagates and ends the run. */
  async function uploadOne(p: PhotoRow): Promise<boolean> {
    if (!p.blob) return false;
    let target: UploadUrlResponse;
    try {
      target = await api<UploadUrlResponse>('/api/photos/upload-url', { catchId: p.catchId, contentType: 'image/jpeg', photoId: p.id });
    } catch (e) {
      if (e instanceof StopSync) throw e;
      return false;
    }
    try {
      // Blob storage is another origin: no cookies. The SAS is signed for image/jpeg.
      const res = await fetchImpl(target.sasUrl, {
        method: 'PUT',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'image/jpeg' },
        body: p.blob,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Clears pending on pushed rows whose updatedAt hasn't moved while the request was in flight. */
  async function clearPending(refs: PushedRef[]): Promise<void> {
    const tables = [...new Set(refs.map((r) => r.table))].map((t) => database.table(t));
    if (!tables.length) return;
    await database.transaction('rw', tables, async () => {
      for (const ref of refs) {
        const table = database.table<{ updatedAt?: string; pending?: number }, string>(ref.table);
        const current = await table.get(ref.id);
        if (current && current.updatedAt === ref.updatedAt) await table.update(ref.id, { pending: 0 });
      }
    });
  }

  /** Applies server docs with last-writer-wins. Returns how many changed a local row. */
  async function applyServerChanges(docs: SyncDoc[]): Promise<number> {
    if (!docs.length) return 0;
    let applied = 0;
    const tables = Object.values(TABLE_FOR).map((t) => database.table(t));
    await database.transaction('rw', tables, async () => {
      for (const doc of docs) {
        const tableName = TABLE_FOR[doc.type];
        if (!tableName) continue; // unknown type from a newer server: ignore
        const table = database.table<{ id: string; updatedAt?: string; pending?: number }, string>(tableName);
        const id = doc.type === 'settings' ? 'settings' : doc.id;
        const local = await table.get(id);
        // Seeded default settings (pending undefined) always yield to the cloud copy, even though
        // their seed timestamp is newer — otherwise a new device would never pick up real settings.
        const localIsSeed = doc.type === 'settings' && local !== undefined && local.pending === undefined;
        const newer = !local || !local.updatedAt || doc.updatedAt > local.updatedAt;
        if (!newer && !localIsSeed) continue;
        // A newer photo doc means the image changed elsewhere (photo ids are reused per catch),
        // so the local blob is stale: drop it and let usePhotoUrl load it from the API.
        await table.put({ ...omit(doc, SERVER_ONLY), id, pending: 0 } as { id: string; pending: number });
        applied++;
      }
    });
    return applied;
  }

  async function saveState(patch: Partial<SyncStateRow>): Promise<void> {
    const prev = (await database.syncState.get(SYNC_STATE_ID)) ?? { id: SYNC_STATE_ID };
    const next: SyncStateRow = { ...prev, ...patch, id: SYNC_STATE_ID };
    if (patch.lastStatus === 'ok') delete next.lastError;
    await database.syncState.put(next);
  }

  async function runOnce(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, photosUploaded: 0, status: 'ok' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await saveState({ lastStatus: 'offline' });
      return { ...result, status: 'offline' };
    }
    try {
      const state = await database.syncState.get(SYNC_STATE_ID);
      const records = await collectRecords(!state?.lastServerTime);
      const photos = await uploadPhotos();
      result.photosUploaded = photos.uploaded;
      // Photo docs go last so a catch lands on the server before the photo that points at it.
      const outgoing = [...records, ...photos.docs];

      let since = state?.lastServerTime ?? null;
      // Always at least one request so a run with nothing to push still pulls.
      for (let i = 0; i === 0 || i < outgoing.length; i += BATCH_SIZE) {
        const batch = outgoing.slice(i, i + BATCH_SIZE);
        const res = await api<SyncResponse>('/api/sync', { since, changes: batch.map((o) => o.doc) });
        await clearPending(batch.map((o) => o.ref));
        result.pushed += batch.length;
        result.pulled += await applyServerChanges(res.serverChanges);
        // Advance `since` only after this response's changes are applied, so a crash re-pulls them.
        since = res.serverTime;
        await saveState({ lastServerTime: since });
      }
      await saveState({ lastSyncAt: new Date().toISOString(), lastStatus: 'ok', photosWaitingForWifi: photos.waitingForWifi });
      return result;
    } catch (e) {
      const status: SyncStatus = e instanceof StopSync ? e.status : 'error';
      const error = e instanceof Error ? e.message : String(e);
      await saveState({ lastStatus: status, lastError: error }).catch(() => undefined);
      return { ...result, status, error };
    }
  }

  let current: Promise<SyncResult> | null = null;
  let again = false;

  /** Runs a sync; a call during an active run makes that run go once more and resolves with the final result. */
  function syncNow(): Promise<SyncResult> {
    if (current) {
      again = true;
      return current;
    }
    current = (async () => {
      let r: SyncResult;
      do {
        again = false;
        r = await runOnce();
      } while (again && r.status === 'ok');
      return r;
    })().finally(() => {
      current = null;
    });
    return current;
  }

  return { syncNow };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
export const syncEngine: SyncEngine = createSyncEngine(db);
export const syncNow = (): Promise<SyncResult> => syncEngine.syncNow();
