import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createApiMcpOauth, disconnectAiHost, inProcessConsentReplayStore,
  isRefreshBindingActive, signAccessToken, signingKeyProvider, verifyAccessToken,
} from '../../dist/oauth/index.js';
import { wireStores } from './wire-stores.ts';

export const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
export const COOKIE = 'fixture_session=opaque-original';
export const RENEWED = 'fixture_session=opaque-renewed';
export const RELOGIN = 'fixture_session=opaque-new-login';
const USER = { subject: 'synthetic-subject', email: 'owner@example.invalid' };
const sessions = new Map([
  [COOKIE, { ...USER, sessionBinding: 'stable-login-nonce' }],
  [RENEWED, { ...USER, sessionBinding: 'stable-login-nonce' }],
  [RELOGIN, { ...USER, sessionBinding: 'different-login-nonce' }],
]);
const resolveSession = (request) => sessions.get(request.headers.get('cookie')) ?? null;

async function dispatch(api, stores, request) {
  const path = new URL(request.url).pathname;
  const route = api.routes.find((entry) => entry.path === path && entry.method === request.method);
  if (route) return route.handle(request);
  if (path === '/resource') {
    try {
      const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      await api.verifyBearer(bearer, request);
      return Response.json({ allowed: true });
    } catch { return Response.json({ error: 'invalid_token' }, { status: 401 }); }
  }
  if (path === '/disconnect' && request.method === 'POST') {
    const session = resolveSession(request);
    if (!session || request.headers.get('origin') !== new URL(request.url).origin) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    return Response.json(await disconnectAiHost(stores, { userId: 'synthetic-user', email: session.email }, 'claude'));
  }
  return new Response(null, { status: 404 });
}

export async function wireFixture(t, eligible = true) {
  const stores = wireStores();
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const api = createApiMcpOauth({
    stores, resolveSession, signingKey: signingKeyProvider(() => ({ pem, kid: 'synthetic-http' })),
    codeReplay: 'in-process', resolveApproval: () => eligible,
    consent: { path: '/consent-screen', replay: inProcessConsentReplayStore(), requireClientApproval: true },
    isAccessTokenActive: (binding) => isRefreshBindingActive(stores.refreshTokens, binding),
    connections: { resolveUserId: () => 'synthetic-user', activityThrottleMs: 0 },
  });
  const errors = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers,
        ...(body.length ? { body } : {}),
      });
      const response = await dispatch(api, stores, request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { errors.push(error); outgoing.writeHead(500); outgoing.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.deepEqual(errors, [], 'unexpected server errors');
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...init });
  return {
    origin, request,
    decision: (ticket, decision = 'approve', headers = {}) => request('/api/oauth/consent', {
      method: 'POST', headers: { cookie: COOKIE, origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ request: ticket, decision }),
    }),
    token: (form) => request('/api/oauth/token', {
      method: 'POST', body: new URLSearchParams(form),
    }),
    legacy: async () => {
      const token = await signAccessToken(api.context.signingKey, { ...USER, origin, scopes: ['mcp:read'] });
      // It is valid under the old signature/audience policy, lacking only binding.
      await verifyAccessToken(api.context.signingKey, token, { origin });
      return token;
    },
  };
}

export async function begin(f, headers = { cookie: COOKIE }) {
  const registered = await f.request('/api/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Synthetic Claude', redirect_uris: [CALLBACK] }),
  });
  assert.equal(registered.status, 201);
  const { client_id: clientId } = await registered.json();
  const verifier = 'synthetic-pkce-verifier-of-at-least-forty-three-characters';
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: 'code',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: 'mcp:read', state: 'opaque-client-state' });
  const response = await f.request(`/api/oauth/authorize?${query}`, { headers });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  return { clientId, verifier, query, location, ticket: location.searchParams.get('request') };
}

export async function approve(f, flow, headers = {}) {
  const response = await f.decision(flow.ticket, 'approve', headers);
  assert.equal(response.status, 200);
  const callback = new URL((await response.json()).redirectUrl);
  assert.equal(callback.origin + callback.pathname, CALLBACK);
  assert.equal(callback.searchParams.get('state'), 'opaque-client-state');
  const code = callback.searchParams.get('code');
  assert.ok(code);
  return { grant_type: 'authorization_code', code, client_id: flow.clientId,
    redirect_uri: CALLBACK, code_verifier: flow.verifier };
}
