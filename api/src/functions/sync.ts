import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getUser } from '../auth';
import { getDocsContainer } from '../cosmos';
import { HttpError, json, toErrorResponse } from '../http';
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

async function applyChanges(userId: string, changes: SyncDoc[], context: InvocationContext): Promise<number> {
  const container = getDocsContainer();
  let applied = 0;
  for (const incoming of changes) {
    // Never trust the client's userId: force ownership from the auth principal.
    // serverUpdatedAt is the server's own clock and is what pulls are keyed on, so a
    // device with a skewed clock can't hide its changes from other devices.
    const doc: SyncDoc = { ...incoming, userId, serverUpdatedAt: new Date().toISOString() };
    const { resource: existing } = await container.item(doc.id, userId).read<SyncDoc>();
    if (existing && existing.updatedAt >= doc.updatedAt) {
      continue; // server copy is newer or equal: last-writer-wins, keep server
    }
    await container.items.upsert(doc);
    applied++;
  }
  context.info(`sync: user=${userId} received=${changes.length} applied=${applied}`);
  return applied;
}

async function fetchServerChanges(userId: string, since: string | null): Promise<SyncDoc[]> {
  const container = getDocsContainer();
  const query =
    since === null
      ? {
          query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.serverUpdatedAt ASC',
          parameters: [{ name: '@userId', value: userId }],
        }
      : {
          query:
            'SELECT * FROM c WHERE c.userId = @userId AND c.serverUpdatedAt > @since ORDER BY c.serverUpdatedAt ASC',
          parameters: [
            { name: '@userId', value: userId },
            { name: '@since', value: since },
          ],
        };
  const { resources } = await container.items.query<SyncDoc>(query, { partitionKey: userId }).fetchAll();
  return resources.map(stripSystemProps);
}

const COSMOS_SYSTEM_PROPS = ['_rid', '_self', '_etag', '_attachments', '_ts'];

/** Strip Cosmos system properties so the client only sees domain fields. */
function stripSystemProps(doc: SyncDoc): SyncDoc {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!COSMOS_SYSTEM_PROPS.includes(k)) out[k] = v;
  }
  return out as SyncDoc;
}

async function syncHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = getUser(req);
    const { since, changes } = parseBody(await req.json());
    // Capture serverTime before the write so the next `since` never misses a
    // document written concurrently during this request.
    const serverTime = new Date().toISOString();
    await applyChanges(user.userId, changes, context);
    const serverChanges = await fetchServerChanges(user.userId, since);
    const body: SyncResponse = { serverChanges, serverTime };
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
