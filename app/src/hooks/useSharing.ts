import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { CatchRow, PondMemberRow } from '../db/db';
import { db } from '../db/db';
import { SYNC_STATE_ID } from '../sync/sync';
import { canEditCatch, membersOf, myMembership, roleFor, type PondRole } from '../lib/sharing';

export interface SharingState {
  viewerId: string | undefined;
  members: PondMemberRow[];
}

const EMPTY: SharingState = { viewerId: undefined, members: [] };

/** Your server id and every membership row on this phone (live). */
export function useSharing(): SharingState {
  return (
    useLiveQuery(async () => {
      const [state, members] = await Promise.all([db.syncState.get(SYNC_STATE_ID), db.pondMembers.toArray()]);
      return { viewerId: state?.viewerId, members };
    }, []) ?? EMPTY
  );
}

export interface PondAccess {
  role: PondRole;
  viewerId: string | undefined;
  /** Set when the pond was shared with you. */
  membership: PondMemberRow | undefined;
  /** People you've shared this pond with (owner only). */
  members: PondMemberRow[];
  shared: boolean;
  canEditCatch: (c: Pick<CatchRow, 'loggedBy'>) => boolean;
}

export function usePondAccess(pondId: string | undefined): PondAccess {
  const { viewerId, members } = useSharing();
  return useMemo(() => {
    const id = pondId ?? '';
    const role = roleFor(id, members, viewerId);
    const others = role === 'owner' ? membersOf(id, members, viewerId) : [];
    return {
      role,
      viewerId,
      membership: myMembership(id, members, viewerId),
      members: others,
      shared: role === 'member' || others.length > 0,
      canEditCatch: (c) => canEditCatch(c, role, viewerId),
    };
  }, [pondId, members, viewerId]);
}
