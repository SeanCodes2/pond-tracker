import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PondRow } from '../db/db';

/** Live list of non-deleted ponds sorted by name; undefined while loading. */
export function usePonds(): PondRow[] | undefined {
  return useLiveQuery(
    async () => (await db.ponds.filter((p) => !p.deletedAt).toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
}

export function usePond(id: string | undefined): PondRow | undefined {
  return useLiveQuery(async () => (id ? db.ponds.get(id) : undefined), [id]);
}
