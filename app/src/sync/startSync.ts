/**
 * When sync runs: on start (once access is confirmed), when the phone comes back online, when
 * the app returns to the foreground, every 15 min while visible, and 3 s after local writes.
 */
import { db, type PondTrackerDB } from '../db/db';
import { accessCheckDisabled, checkAccess, previouslyAllowed } from '../lib/access';
import { syncEngine, type SyncEngine } from './sync';

const DEBOUNCE_MS = 3_000;
const INTERVAL_MS = 15 * 60_000;

/** Local dev and tests have no /api; opt in with localStorage['pt:forceSync'] = '1'. */
export function syncEnabled(): boolean {
  if (!accessCheckDisabled()) return true;
  try {
    return localStorage.getItem('pt:forceSync') === '1';
  } catch {
    return false;
  }
}

let started = false;

export async function startSync(database: PondTrackerDB = db, engine: SyncEngine = syncEngine): Promise<void> {
  if (started || !syncEnabled()) return;
  const access = await checkAccess();
  // AccessGate redirects signed-out / not-invited users; offline on an approved device still arms the triggers.
  if (!(access === 'allowed' || (access === 'offline' && previouslyAllowed()))) return;
  started = true;

  // After a 401/403 the automatic background triggers (writes, timer) stand down so a signed-out
  // phone doesn't hit the API on every edit; start/online/foreground/"Sync now" still try.
  let blocked = false;
  const run = (automatic: boolean) => {
    if (automatic && blocked) return;
    void engine.syncNow().then((r) => {
      blocked = r.status === 'signed-out';
    });
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(true), DEBOUNCE_MS);
  };

  // Every repo write sets pending: 1, while the sync engine's own writes set pending: 0 — so the
  // hooks fire for user edits only and a sync never re-triggers itself.
  for (const table of [database.ponds, database.catches, database.feedingLogs, database.photos, database.settings]) {
    table.hook('creating', (_key, obj: { pending?: number }) => {
      if (obj.pending === 1) schedule();
    });
    table.hook('updating', (mods: { pending?: number }, _key, obj: { pending?: number }) => {
      const pending = 'pending' in mods ? mods.pending : obj.pending;
      if (pending === 1) schedule();
    });
  }

  window.addEventListener('online', () => run(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run(false);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') run(true);
  }, INTERVAL_MS);

  run(false);
}
