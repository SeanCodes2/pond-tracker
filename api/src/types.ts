/**
 * Minimal sync document shape. Deliberately local to the API so it does not
 * depend on @pond-tracker/shared being built at API build time. Keep in step
 * with the shared package's record types (id / userId / updatedAt / deletedAt).
 */
export type SyncDocType = 'pond' | 'catch' | 'feedingLog' | 'settings' | 'photo';

export const SYNC_DOC_TYPES: readonly SyncDocType[] = [
  'pond',
  'catch',
  'feedingLog',
  'settings',
  'photo',
];

export interface SyncDoc {
  id: string;
  type: SyncDocType;
  userId: string;
  /** ISO-8601 timestamp; last-writer-wins conflict resolution key. */
  updatedAt: string;
  /** ISO-8601 timestamp; present when the record is a tombstone. */
  deletedAt?: string;
  /** Set by the server on every write; `since` in a sync request compares against this. */
  serverUpdatedAt?: string;
  [k: string]: unknown;
}

export interface SyncRequest {
  since: string | null;
  changes: SyncDoc[];
}

export interface SyncResponse {
  serverChanges: SyncDoc[];
  serverTime: string;
}

export function isSyncDocType(v: unknown): v is SyncDocType {
  return typeof v === 'string' && (SYNC_DOC_TYPES as readonly string[]).includes(v);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
}
