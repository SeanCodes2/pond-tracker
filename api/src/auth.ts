import type { HttpRequest } from '@azure/functions';
import { HttpError } from './http';

export interface AuthUser {
  userId: string;
  name: string;
  provider: string;
}

/** Shape of the JSON that Static Web Apps base64-encodes into x-ms-client-principal. */
interface ClientPrincipal {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
}

const PRINCIPAL_HEADER = 'x-ms-client-principal';

/**
 * Resolve the calling user from the SWA-injected principal header.
 * Throws HttpError(401) when absent, unless ALLOW_ANONYMOUS_DEV=true
 * (local `func start` without the SWA emulator), in which case a fixed
 * dev user is returned.
 */
export function getUser(req: HttpRequest): AuthUser {
  const raw = req.headers.get(PRINCIPAL_HEADER);

  if (!raw) {
    if (process.env.ALLOW_ANONYMOUS_DEV === 'true') {
      return { userId: 'dev-user', name: 'Local Dev', provider: 'dev' };
    }
    throw new HttpError(401, 'Not authenticated');
  }

  let principal: ClientPrincipal;
  try {
    principal = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as ClientPrincipal;
  } catch {
    throw new HttpError(401, 'Invalid client principal');
  }

  if (!principal.userId) {
    throw new HttpError(401, 'Client principal has no userId');
  }

  return {
    userId: principal.userId,
    name: principal.userDetails ?? '',
    provider: principal.identityProvider ?? 'unknown',
  };
}
