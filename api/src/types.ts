/**
 * Minimal sync document shape. Deliberately local to the API so it does not
 * depend on @pond-tracker/shared being built at API build time. Keep in step
 * with the shared package's record types (id / userId / updatedAt / deletedAt).
 */
export type SyncDocType = 'pond' | 'catch' | 'feedingLog' | 'settings' | 'photo';

/**
 * Doc types the server writes itself and clients never push:
 *  - pondMember: someone other than the owner has access to a pond. Lives in the OWNER's
 *    partition (userId = owner) so the owner's normal pull includes the member list.
 *  - pondInvite: a one-time join code. Lives in the owner's partition and is never pulled.
 */
export type ServerDocType = 'pondMember' | 'pondInvite';
export type AnyDocType = SyncDocType | ServerDocType;

export const SYNC_DOC_TYPES: readonly SyncDocType[] = [
  'pond',
  'catch',
  'feedingLog',
  'settings',
  'photo',
];

export interface SyncDoc {
  id: string;
  type: AnyDocType;
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

/**
 * A pushed change the caller isn't allowed to make (e.g. a member editing a shared pond's
 * settings). `doc` is the server's current copy for the client to restore; when there is
 * none the client drops its local row.
 */
export interface RejectedChange {
  id: string;
  type: SyncDocType;
  reason: string;
  doc?: SyncDoc;
}

export interface SyncResponse {
  serverChanges: SyncDoc[];
  serverTime: string;
  /** The caller's userId, so the app can tell its own records from shared ones. */
  viewerId: string;
  rejected: RejectedChange[];
}

/** pondMember doc as stored. id = memberDocId(pondId, memberId); userId = ownerId. */
export interface PondMemberDoc extends SyncDoc {
  type: 'pondMember';
  pondId: string;
  ownerId: string;
  ownerName: string;
  memberId: string;
  memberName: string;
  pondName: string;
  role: 'member';
  joinedAt: string;
}

/** pondInvite doc as stored. id = `inv_${code}`; userId = ownerId. */
export interface PondInviteDoc extends SyncDoc {
  type: 'pondInvite';
  code: string;
  pondId: string;
  pondName: string;
  ownerName: string;
  expiresAt: string;
}

export function isSyncDocType(v: unknown): v is SyncDocType {
  return typeof v === 'string' && (SYNC_DOC_TYPES as readonly string[]).includes(v);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
}
