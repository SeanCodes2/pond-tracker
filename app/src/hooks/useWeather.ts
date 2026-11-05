import { useLiveQuery } from 'dexie-react-hooks';
import type { CatchWeatherRow } from '../db/db';
import { db } from '../db/db';

/** The looked-up weather for one catch, if the server has filled it in yet. */
export function useCatchWeather(catchId: string | undefined): CatchWeatherRow | undefined {
  return useLiveQuery(async () => (catchId ? db.catchWeather.where('catchId').equals(catchId).first() : undefined), [catchId]);
}

/** Weather for many catches, keyed by catchId (live). */
export function useWeatherByCatch(): Map<string, CatchWeatherRow> {
  return (
    useLiveQuery(async () => {
      const rows = await db.catchWeather.toArray();
      return new Map(rows.map((w) => [w.catchId, w]));
    }, []) ?? EMPTY
  );
}

const EMPTY = new Map<string, CatchWeatherRow>();
