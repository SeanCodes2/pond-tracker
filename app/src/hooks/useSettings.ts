import { useLiveQuery } from 'dexie-react-hooks';
import type { Settings } from '@pond-tracker/shared';
import { DEFAULT_SETTINGS } from '@pond-tracker/shared';
import { db } from '../db/db';

/** Live settings; falls back to defaults until the seed row is read. */
export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('settings'), [], undefined) ?? DEFAULT_SETTINGS;
}
