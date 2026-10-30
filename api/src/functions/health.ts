import { app, type HttpResponseInit } from '@azure/functions';
import { json } from '../http';

async function healthHandler(): Promise<HttpResponseInit> {
  return json({ ok: true, time: new Date().toISOString() });
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthHandler,
});
