import { useCallback, useEffect, useRef, useState } from 'react';
import type { PondRow } from '../db/db';
import { getCurrentPosition, pickPondByGeofence } from '../lib/geo';
import { usePonds } from './usePonds';

const LAST_POND_KEY = 'pt:lastPondId';

function readLast(): string | undefined {
  try {
    return localStorage.getItem(LAST_POND_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLast(id: string): void {
  try {
    localStorage.setItem(LAST_POND_KEY, id);
  } catch {
    // ignore
  }
}

export type PondSource = 'gps' | 'last' | 'manual' | 'none';

export interface CurrentPond {
  ponds: PondRow[] | undefined;
  pond: PondRow | undefined;
  source: PondSource;
  locating: boolean;
  select: (id: string) => void;
  relocate: () => void;
}

/**
 * Picks the active pond: by geofence when GPS is available, otherwise the
 * last-used pond, otherwise the first pond. A manual pick sticks until the
 * user asks to relocate.
 */
export function useCurrentPond(): CurrentPond {
  const ponds = usePonds();
  const [manualId, setManualId] = useState<string | undefined>(undefined);
  const [gpsId, setGpsId] = useState<string | undefined>(undefined);
  const [locating, setLocating] = useState(false);
  const [lastId, setLastId] = useState<string | undefined>(readLast);
  const attempted = useRef(false);

  const locate = useCallback(async (list: PondRow[]) => {
    if (!list.some((p) => p.lat !== undefined && p.lon !== undefined)) return;
    setLocating(true);
    const pos = await getCurrentPosition();
    setLocating(false);
    if (!pos) return;
    const hit = pickPondByGeofence(list, pos);
    if (hit) {
      setGpsId(hit.id);
      setLastId(hit.id);
      writeLast(hit.id);
    }
  }, []);

  useEffect(() => {
    if (!ponds || attempted.current) return;
    attempted.current = true;
    void locate(ponds);
  }, [ponds, locate]);

  const select = useCallback((id: string) => {
    setManualId(id);
    setLastId(id);
    writeLast(id);
  }, []);

  const relocate = useCallback(() => {
    if (!ponds) return;
    setManualId(undefined);
    setGpsId(undefined);
    void locate(ponds);
  }, [ponds, locate]);

  let pond: PondRow | undefined;
  let source: PondSource = 'none';
  if (ponds) {
    const byId = (id: string | undefined) => (id ? ponds.find((p) => p.id === id) : undefined);
    if (manualId && byId(manualId)) {
      pond = byId(manualId);
      source = 'manual';
    } else if (gpsId && byId(gpsId)) {
      pond = byId(gpsId);
      source = 'gps';
    } else if (lastId && byId(lastId)) {
      pond = byId(lastId);
      source = 'last';
    } else {
      pond = ponds[0];
      source = pond ? 'last' : 'none';
    }
  }

  return { ponds, pond, source, locating, select, relocate };
}
