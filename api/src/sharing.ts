/**
 * Pond sharing: who may write what, where shared records live, and what each user pulls.
 *
 * Model
 *  - Every record lives in its owner's partition (userId = owner). A pond's catches, feeding logs
 *    and photo docs stay with the pond, so a member's catch in a shared pond is stored in the
 *    OWNER's partition with loggedBy = the member.
 *  - Access to someone else's pond is a pondMember doc (also in the owner's partition) created
 *    only by redeeming a one-time invite code. Tombstoning it (owner removes, member leaves)
 *    revokes access; the member's app then drops that pond's local data.
 *
 * Permissions in a shared pond
 *  - Owner: everything, including editing or deleting members' catches.
 *  - Member: sees the pond, all its catches and the feeder history; logs new catches; edits,
 *    deletes and adds photos to the catches they logged. Pond settings and the feeder are
 *    owner-only.
 *
 * The client never chooses a partition or a loggedBy: both are derived here from the auth
 * principal and the server's own records.
 */
import { randomInt } from 'node:crypto';
import { HttpError } from './http';
import type { DocStore } from './store';
import type { PondInviteDoc, PondMemberDoc, RejectedChange, SyncDoc, SyncDocType } from './types';

export interface Viewer {
  userId: string;
  name: string;
}

export type Now = () => Date;

export interface Access {
  /** Ponds currently shared with the viewer, by pondId. */
  shared: Map<string, PondMemberDoc>;
  /** Ponds the viewer used to have access to (left or removed). */
  revoked: Set<string>;
  /** Every membership doc for the viewer, tombstones included. */
  memberships: PondMemberDoc[];
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const CODE_LENGTH = 8;
const COSMOS_SYSTEM_PROPS = ['_rid', '_self', '_etag', '_attachments', '_ts'];
/** Server bookkeeping that never goes to the client. */
const HIDDEN_PROPS = [...COSMOS_SYSTEM_PROPS, 'blobPath'];

/** Cosmos ids can't contain / \ ? #. */
const safe = (s: string): string => s.replace(/[/\\?#]/g, '_');

export function memberDocId(pondId: string, memberId: string): string {
  return `pm_${safe(pondId)}_${safe(memberId)}`;
}

export function inviteDocId(code: string): string {
  return `inv_${code}`;
}

export function generateInviteCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Accepts "abcd-2345", "ABCD 2345", etc. Returns undefined when it can't be a code. */
export function normalizeInviteCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return undefined;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return undefined;
  return code;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Who logged a catch. Catches written before sharing existed have no loggedBy: they're the owner's. */
const loggedByOf = (doc: SyncDoc, partition: string): string => str(doc['loggedBy']) ?? partition;

/** Shapes a stored doc for the client: drops server-only props and fills defaults. */
export function present(doc: SyncDoc, partition: string): SyncDoc {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!HIDDEN_PROPS.includes(k)) out[k] = v;
  if (doc.type === 'catch' && out['loggedBy'] === undefined) out['loggedBy'] = partition;
  return out as SyncDoc;
}

export async function loadAccess(store: DocStore, viewerId: string): Promise<Access> {
  const memberships = await store.membershipsOf(viewerId);
  const shared = new Map<string, PondMemberDoc>();
  const revoked = new Set<string>();
  for (const m of memberships) {
    // Never treat your own pond as shared with you (can't happen via join, but be safe).
    if (m.ownerId === viewerId) continue;
    if (m.deletedAt) revoked.add(m.pondId);
    else shared.set(m.pondId, m);
  }
  for (const id of shared.keys()) revoked.delete(id);
  return { shared, revoked, memberships };
}

// ---------------------------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------------------------

type Route =
  | { partition: string; extra?: Record<string, unknown>; existing?: SyncDoc | null }
  | { reject: string; partition?: string };

const OWNER_ONLY = 'Only the pond owner can change this';

async function route(store: DocStore, viewer: Viewer, access: Access, doc: SyncDoc): Promise<Route> {
  const me = viewer.userId;
  switch (doc.type) {
    case 'settings':
      return { partition: me };

    case 'pond': {
      const m = access.shared.get(doc.id);
      if (m) return { reject: OWNER_ONLY, partition: m.ownerId };
      if (access.revoked.has(doc.id)) return { reject: 'You no longer have access to this pond' };
      return { partition: me };
    }

    case 'feedingLog': {
      const pondId = str(doc['pondId']) ?? '';
      const m = access.shared.get(pondId);
      if (m) return { reject: OWNER_ONLY, partition: m.ownerId };
      if (access.revoked.has(pondId)) return { reject: 'You no longer have access to this pond' };
      return { partition: me };
    }

    case 'catch': {
      const pondId = str(doc['pondId']) ?? '';
      const m = access.shared.get(pondId);
      if (m) {
        const owner = m.ownerId;
        const existing = (await store.read(doc.id, owner)) ?? null;
        if (existing) {
          if (loggedByOf(existing, owner) !== me) return { reject: 'Only the person who logged this catch can change it', partition: owner };
          if (existing['pondId'] !== pondId) return { reject: 'A catch in a shared pond can’t be moved', partition: owner };
          return { partition: owner, existing, extra: { loggedBy: me, loggedByName: existing['loggedByName'] ?? viewer.name } };
        }
        return { partition: owner, existing, extra: { loggedBy: me, loggedByName: viewer.name } };
      }
      if (access.revoked.has(pondId)) return { reject: 'You no longer have access to this pond' };
      const existing = (await store.read(doc.id, me)) ?? null;
      return {
        partition: me,
        existing,
        extra: existing
          ? { loggedBy: loggedByOf(existing, me), loggedByName: existing['loggedByName'] ?? viewer.name }
          : { loggedBy: me, loggedByName: viewer.name },
      };
    }

    case 'photo': {
      const catchId = str(doc['catchId']) ?? '';
      // Photos are always uploaded under the uploader's own blob folder (see photos.ts).
      const blobPath = `${me}/${doc.id.toLowerCase()}.jpg`;
      const own = await store.read(catchId, me);
      if (own?.type === 'catch') return { partition: me, extra: { blobPath, pondId: own['pondId'] } };
      for (const m of access.shared.values()) {
        const c = await store.read(catchId, m.ownerId);
        if (c?.type === 'catch' && c['pondId'] === m.pondId) {
          if (loggedByOf(c, m.ownerId) !== me) return { reject: 'Only the person who logged this catch can change its photo', partition: m.ownerId };
          return { partition: m.ownerId, extra: { blobPath, pondId: m.pondId } };
        }
      }
      // Catch not on the server (yet): keep the pre-sharing behaviour and store it as the caller's.
      return { partition: me, extra: { blobPath } };
    }

    default:
      // pondMember / pondInvite are written by the server only.
      return { reject: 'Not a type the app can write' };
  }
}

export interface ApplyResult {
  applied: number;
  rejected: RejectedChange[];
}

/** Writes pushed changes with last-writer-wins on updatedAt, enforcing sharing permissions. */
export async function applyChanges(store: DocStore, viewer: Viewer, access: Access, changes: SyncDoc[], now: Now): Promise<ApplyResult> {
  let applied = 0;
  const rejected: RejectedChange[] = [];
  for (const incoming of changes) {
    const r = await route(store, viewer, access, incoming);
    if ('reject' in r) {
      const current = r.partition ? await store.read(incoming.id, r.partition) : undefined;
      rejected.push({
        id: incoming.id,
        type: incoming.type as SyncDocType,
        reason: r.reject,
        ...(current && r.partition ? { doc: present(current, r.partition) } : {}),
      });
      continue;
    }
    const existing = r.existing === undefined ? await store.read(incoming.id, r.partition) : r.existing ?? undefined;
    if (existing && existing.updatedAt >= incoming.updatedAt) continue; // server copy is newer or equal
    // serverUpdatedAt is the server's own clock and is what pulls are keyed on, so a device with a
    // skewed clock can't hide its changes from other devices.
    await store.upsert({ ...incoming, ...r.extra, userId: r.partition, serverUpdatedAt: now().toISOString() });
    applied++;
  }
  return { applied, rejected };
}

// ---------------------------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------------------------

/**
 * Everything the viewer should receive since `since`: their own partition, their membership
 * docs, and the ponds shared with them. A pond joined after `since` is sent in full.
 */
export async function fetchChanges(store: DocStore, viewer: Viewer, access: Access, since: string | null): Promise<SyncDoc[]> {
  const me = viewer.userId;
  const byKey = new Map<string, SyncDoc>();
  const add = (doc: SyncDoc, partition: string) => byKey.set(`${partition}|${doc.id}`, present(doc, partition));

  for (const d of await store.partitionChanges(me, since)) add(d, me);

  for (const m of access.memberships) {
    if (m.ownerId === me) continue;
    if (since === null || (m.serverUpdatedAt ?? '') > since) add(m, m.ownerId);
  }

  for (const m of access.shared.values()) {
    const fresh = since === null || (m.serverUpdatedAt ?? '') > since;
    const pondSince = fresh ? null : since;
    const docs = await store.pondChanges(m.ownerId, m.pondId, pondSince);
    for (const d of docs) add(d, m.ownerId);
    if (fresh) {
      // Photo docs written before sharing existed carry no pondId; find them through their catches.
      const catchIds = docs.filter((d) => d.type === 'catch').map((d) => d.id);
      for (const p of await store.photosForCatches(m.ownerId, catchIds)) add(p, m.ownerId);
    }
  }

  return [...byKey.values()].sort((a, b) => String(a.serverUpdatedAt ?? '').localeCompare(String(b.serverUpdatedAt ?? '')));
}

// ---------------------------------------------------------------------------------------------
// Invites and membership
// ---------------------------------------------------------------------------------------------

export async function createInvite(
  store: DocStore,
  viewer: Viewer,
  pondId: unknown,
  now: Now,
  makeCode: () => string = generateInviteCode,
): Promise<{ code: string; expiresAt: string }> {
  const id = str(pondId);
  if (!id) throw new HttpError(400, '`pondId` is required');
  const pond = await store.read(id, viewer.userId);
  if (!pond || pond.type !== 'pond' || pond.deletedAt) {
    throw new HttpError(404, 'Pond not found. If you just created it, wait for it to sync and try again.');
  }
  const t = now();
  const code = makeCode();
  const invite: PondInviteDoc = {
    id: inviteDocId(code),
    type: 'pondInvite',
    userId: viewer.userId,
    code,
    pondId: id,
    pondName: String(pond['name'] ?? ''),
    ownerName: viewer.name,
    expiresAt: new Date(t.getTime() + INVITE_TTL_MS).toISOString(),
    updatedAt: t.toISOString(),
    serverUpdatedAt: t.toISOString(),
  };
  await store.upsert(invite);
  return { code, expiresAt: invite.expiresAt };
}

export async function joinWithCode(store: DocStore, viewer: Viewer, rawCode: unknown, now: Now): Promise<{ pondId: string; pondName: string }> {
  const code = normalizeInviteCode(rawCode);
  if (!code) throw new HttpError(400, 'That code doesn’t look right. It’s 8 letters and numbers, like ABCD-2345.');
  const invite = await store.findInvite(code);
  if (!invite) throw new HttpError(404, 'Code not found. It may have already been used.');
  const t = now();
  if (invite.expiresAt <= t.toISOString()) {
    await store.remove(invite.id, invite.userId);
    throw new HttpError(410, 'That code has expired. Ask for a new one.');
  }
  const ownerId = invite.userId;
  if (ownerId === viewer.userId) throw new HttpError(400, 'That’s your own pond.');
  const pond = await store.read(invite.pondId, ownerId);
  if (!pond || pond.type !== 'pond' || pond.deletedAt) {
    await store.remove(invite.id, ownerId);
    throw new HttpError(404, 'That pond no longer exists.');
  }

  const id = memberDocId(invite.pondId, viewer.userId);
  const existing = await store.read(id, ownerId);
  const ts = t.toISOString();
  const member: PondMemberDoc = {
    id,
    type: 'pondMember',
    userId: ownerId,
    pondId: invite.pondId,
    ownerId,
    ownerName: invite.ownerName,
    memberId: viewer.userId,
    memberName: viewer.name,
    pondName: String(pond['name'] ?? invite.pondName),
    role: 'member',
    joinedAt: existing && !existing.deletedAt ? String(existing['joinedAt']) : ts,
    updatedAt: ts,
    serverUpdatedAt: ts,
  };
  await store.upsert(member); // also clears deletedAt when rejoining
  await store.remove(invite.id, ownerId);
  return { pondId: invite.pondId, pondName: member.pondName };
}

async function tombstone(store: DocStore, m: PondMemberDoc, now: Now): Promise<void> {
  const ts = now().toISOString();
  await store.upsert({ ...m, deletedAt: ts, updatedAt: ts, serverUpdatedAt: ts });
}

/** A member leaves a pond shared with them. */
export async function leavePond(store: DocStore, viewer: Viewer, pondId: unknown, now: Now): Promise<void> {
  const id = str(pondId);
  if (!id) throw new HttpError(400, '`pondId` is required');
  const m = (await store.membershipsOf(viewer.userId)).find((x) => x.pondId === id && !x.deletedAt);
  if (!m) throw new HttpError(404, 'You’re not a member of that pond.');
  await tombstone(store, m, now);
}

/** The owner removes someone from their pond. */
export async function removeMember(store: DocStore, viewer: Viewer, pondId: unknown, memberId: unknown, now: Now): Promise<void> {
  const p = str(pondId);
  const u = str(memberId);
  if (!p || !u) throw new HttpError(400, '`pondId` and `memberId` are required');
  const m = await store.read(memberDocId(p, u), viewer.userId);
  if (!m || m.type !== 'pondMember' || m.deletedAt) throw new HttpError(404, 'That person isn’t a member of this pond.');
  await tombstone(store, m as PondMemberDoc, now);
}

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

/**
 * Blob name for a photo the viewer may see: their own, one in a pond they own (even if a member
 * uploaded it), or one in a pond shared with them. Falls back to the viewer's own folder for a
 * photo uploaded but not yet synced; the caller checks the blob exists.
 */
export async function resolvePhotoBlob(store: DocStore, viewerId: string, photoId: string, access: Access): Promise<string> {
  const own = await store.read(photoId, viewerId);
  if (own?.type === 'photo') return str(own['blobPath']) ?? `${viewerId}/${photoId}.jpg`;
  for (const m of access.shared.values()) {
    const d = await store.read(photoId, m.ownerId);
    if (d?.type !== 'photo') continue;
    let pondId = str(d['pondId']);
    if (!pondId) pondId = str((await store.read(str(d['catchId']) ?? '', m.ownerId))?.['pondId']);
    if (pondId === m.pondId) return str(d['blobPath']) ?? `${m.ownerId}/${photoId}.jpg`;
  }
  return `${viewerId}/${photoId}.jpg`;
}
