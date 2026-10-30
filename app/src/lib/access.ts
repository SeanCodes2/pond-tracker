/**
 * Invite-only access check, done in the app rather than by SWA route rules.
 *
 * Why client-side: if the server gates the app's own files, any background service-worker
 * update that runs without a valid session caches the login page as the app shell, and the
 * installed app is stuck on it. So static files are public (the code is a public repo and all
 * data is on-device); the app checks /.auth/me on launch, and the API — where synced data will
 * live — stays enforced server-side by the `angler` role in staticwebapp.config.json.
 */

export const REQUIRED_ROLE = 'angler';
const KEY = 'pt:access';

export type AccessResult = 'allowed' | 'signed-out' | 'not-invited' | 'offline';

interface ClientPrincipal {
  userRoles?: string[];
}

/** No SWA auth endpoint in local dev / tests. */
export function accessCheckDisabled(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

export async function checkAccess(): Promise<AccessResult> {
  if (accessCheckDisabled()) return 'allowed';
  let principal: ClientPrincipal | null;
  try {
    const res = await fetch('/.auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return 'offline';
    const body = (await res.json()) as { clientPrincipal: ClientPrincipal | null };
    principal = body.clientPrincipal;
  } catch {
    return 'offline';
  }
  if (!principal) {
    remember(false);
    return 'signed-out';
  }
  const ok = (principal.userRoles ?? []).includes(REQUIRED_ROLE);
  remember(ok);
  return ok ? 'allowed' : 'not-invited';
}

/** Whether this device has been approved before (used to open instantly and to allow offline). */
export function previouslyAllowed(): boolean {
  if (accessCheckDisabled()) return true;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function remember(ok: boolean): void {
  try {
    if (ok) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
