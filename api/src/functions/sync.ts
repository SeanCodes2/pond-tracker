import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getUser } from '../auth';
import { HttpError, json, toErrorResponse } from '../http';
import { applyChanges, fetchChanges, loadAccess } from '../sharing';
import { getStore } from '../store';
import { isIsoDate, isSyncDocType, type SyncDoc, type SyncRequest, type SyncResponse } from '../types';

const MAX_CHANGES = 500;

function parseBody(body: unknown): SyncRequest {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  const { since, changes } = body as Partial<SyncRequest>;
  if (since !== null && since !== undefined && !isIsoDate(since)) {
    throw new HttpError(400, '`since` must be an ISO timestamp or null');
  }
  if (!Array.isArray(changes)) {
    throw new HttpError(400, '`changes` must be an array');
  }
  if (changes.length > MAX_CHANGES) {
    throw new HttpError(413, `Too many changes in one request (max ${MAX_CHANGES})`);
  }
  for (const c of changes) {
    if (typeof c !== 'object' || c === null) throw new HttpError(400, 'Each change must be an object');
    const d = c as Partial<SyncDoc>;
    if (typeof d.id !== 'string' || d.id.length === 0) throw new HttpError(400, 'Change is missing `id`');
    if (!isSyncDocType(d.type)) throw new HttpError(400, `Change ${d.id} has an invalid \`type\``);
    if (!isIsoDate(d.updatedAt)) throw new HttpError(400, `Change ${d.id} has an invalid \`updatedAt\``);
    if (d.deletedAt !== undefined && !isIsoDate(d.deletedAt)) {
      throw new HttpError(400, `Change ${d.id} has an invalid \`deletedAt\``);
    }
  }
  return { since: since ?? null, changes: changes as SyncDoc[] };
}

async function syncHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = getUser(req);
    const { since, changes } = parseBody(await req.json());
    // Capture serverTime before the write so the next `since` never misses a
    // document written concurrently during this request.
    const serverTime = new Date().toISOString();
    const store = getStore();
    const viewer = { userId: user.userId, name: user.name };
    const access = await loadAccess(store, user.userId);
    const { applied, rejected } = await applyChanges(store, viewer, access, changes, () => new Date());
    context.info(`sync: user=${user.userId} received=${changes.length} applied=${applied} rejected=${rejected.length} shared=${access.shared.size}`);
    const serverChanges = await fetchChanges(store, viewer, access, since);
    const body: SyncResponse = { serverChanges, serverTime, viewerId: user.userId, rejected };
    return json(body);
  } catch (err) {
    return toErrorResponse(err, context);
  }
}

app.http('sync', {
  methods: ['POST'],
  authLevel: 'anonymous', // SWA handles auth; see staticwebapp.config.json routes
  route: 'sync',
  handler: syncHandler,
});
