import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getUser } from '../auth';
import { HttpError, json, toErrorResponse } from '../http';
import { createInvite, joinWithCode, leavePond, removeMember } from '../sharing';
import { getStore } from '../store';

const now = () => new Date();

async function body(req: HttpRequest): Promise<Record<string, unknown>> {
  const b = (await req.json()) as unknown;
  if (typeof b !== 'object' || b === null) throw new HttpError(400, 'Body must be a JSON object');
  return b as Record<string, unknown>;
}

function handler(fn: (req: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>) {
  return async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      return await fn(req, context);
    } catch (err) {
      return toErrorResponse(err, context);
    }
  };
}

/** Owner: create a one-time code someone can enter to join a pond. */
app.http('sharesInvite', {
  methods: ['POST'],
  authLevel: 'anonymous', // SWA enforces the angler role on /api/*
  route: 'shares/invite',
  handler: handler(async (req, context) => {
    const user = getUser(req);
    const b = await body(req);
    const res = await createInvite(getStore(), user, b['pondId'], now);
    context.info(`shares: invite user=${user.userId} pond=${String(b['pondId'])}`);
    return json(res);
  }),
});

/** Anyone with the angler role: redeem a code. */
app.http('sharesJoin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'shares/join',
  handler: handler(async (req, context) => {
    const user = getUser(req);
    const b = await body(req);
    const res = await joinWithCode(getStore(), user, b['code'], now);
    context.info(`shares: join user=${user.userId} pond=${res.pondId}`);
    return json(res);
  }),
});

/** Member: leave a pond shared with you. */
app.http('sharesLeave', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'shares/leave',
  handler: handler(async (req, context) => {
    const user = getUser(req);
    const b = await body(req);
    await leavePond(getStore(), user, b['pondId'], now);
    context.info(`shares: leave user=${user.userId} pond=${String(b['pondId'])}`);
    return json({ ok: true });
  }),
});

/** Owner: remove someone from your pond. */
app.http('sharesRemove', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'shares/remove',
  handler: handler(async (req, context) => {
    const user = getUser(req);
    const b = await body(req);
    await removeMember(getStore(), user, b['pondId'], b['memberId'], now);
    context.info(`shares: remove owner=${user.userId} pond=${String(b['pondId'])} member=${String(b['memberId'])}`);
    return json({ ok: true });
  }),
});
