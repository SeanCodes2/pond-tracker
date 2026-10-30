import type { HttpResponseInit, InvocationContext } from '@azure/functions';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponseInit {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  };
}

export function error(status: number, message: string): HttpResponseInit {
  return json({ error: message }, status);
}

/** Convert any thrown value into an HTTP response, logging unexpected ones. */
export function toErrorResponse(err: unknown, context: InvocationContext): HttpResponseInit {
  if (err instanceof HttpError) {
    return error(err.status, err.message);
  }
  if (err instanceof SyntaxError) {
    return error(400, 'Malformed JSON body');
  }
  context.error('Unhandled error', err);
  return error(500, 'Internal server error');
}

/** Read an env var or throw a 500-level error naming the missing setting. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new HttpError(500, `Missing required app setting: ${name}`);
  }
  return v;
}
