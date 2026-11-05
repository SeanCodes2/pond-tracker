/**
 * Pond sharing on the phone: who may change what (mirrors api/src/sharing.ts, which is what
 * actually enforces it) and the online-only calls for invite codes and membership.
 */
import type { CatchRow, PondMemberRow } from '../db/db';
import { db, type PondTrackerDB } from '../db/db';
import { dropSharedPond } from '../sync/sync';

export type PondRole = 'owner' | 'member';

/** Your role for a pond: 'member' if someone shared it with you, otherwise it's yours. */
export function roleFor(pondId: string, members: readonly PondMemberRow[], viewerId: string | undefined): PondRole {
  if (!viewerId) return 'owner';
  return members.some((m) => m.pondId === pondId && !m.deletedAt && m.memberId === viewerId) ? 'member' : 'owner';
}

/** The membership that gives you access to someone else's pond, if any. */
export function myMembership(pondId: string, members: readonly PondMemberRow[], viewerId: string | undefined): PondMemberRow | undefined {
  if (!viewerId) return undefined;
  return members.find((m) => m.pondId === pondId && !m.deletedAt && m.memberId === viewerId);
}

/** People you've shared one of your ponds with. */
export function membersOf(pondId: string, members: readonly PondMemberRow[], viewerId: string | undefined): PondMemberRow[] {
  return members
    .filter((m) => m.pondId === pondId && !m.deletedAt && m.memberId !== viewerId)
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
}

/** A catch with no loggedBy was logged on this phone and hasn't come back from a sync: it's yours. */
export function isMine(c: Pick<CatchRow, 'loggedBy'>, viewerId: string | undefined): boolean {
  return !c.loggedBy || c.loggedBy === viewerId;
}

export function canEditCatch(c: Pick<CatchRow, 'loggedBy'>, role: PondRole, viewerId: string | undefined): boolean {
  return role === 'owner' || isMine(c, viewerId);
}

/** "buddy@example.com" → "buddy". Names are sign-in emails, which are long on a phone. */
export function shortName(name: string | undefined): string {
  if (!name) return 'someone';
  const at = name.indexOf('@');
  return at > 0 ? name.slice(0, at) : name;
}

/** "ABCD2345" → "ABCD-2345" for reading aloud or texting. */
export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// ---------------------------------------------------------------------------------------------
// API calls (need a connection)
// ---------------------------------------------------------------------------------------------

export class ShareError extends Error {}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ShareError('You need a connection for this. Try again when you have signal.');
  }
  if (res.ok) return (await res.json()) as T;
  let message = `Something went wrong (HTTP ${res.status}).`;
  try {
    const b = (await res.json()) as { error?: string };
    if (b.error) message = b.error;
  } catch {
    // keep the generic message
  }
  if (res.status === 401 || res.status === 403) message = 'You’re signed out. Open the app online to sign back in.';
  throw new ShareError(message);
}

export function createInvite(pondId: string): Promise<{ code: string; expiresAt: string }> {
  return post('/api/shares/invite', { pondId });
}

export function joinPond(code: string): Promise<{ pondId: string; pondName: string }> {
  return post('/api/shares/join', { code });
}

export function removeMember(pondId: string, memberId: string): Promise<{ ok: true }> {
  return post('/api/shares/remove', { pondId, memberId });
}

/** Leaves on the server, then clears the pond off this phone right away. */
export async function leavePond(pondId: string, database: PondTrackerDB = db): Promise<void> {
  await post('/api/shares/leave', { pondId });
  await database.transaction('rw', [database.ponds, database.catches, database.feedingLogs, database.photos, database.pondMembers, database.catchWeather], () =>
    dropSharedPond(database, pondId),
  );
}
