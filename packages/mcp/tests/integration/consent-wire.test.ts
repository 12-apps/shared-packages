import assert from 'node:assert/strict';
import test from 'node:test';
import { CALLBACK, COOKIE, RENEWED, RELOGIN, approve, begin, wireFixture } from './consent-wire-fixture.ts';

const options = { timeout: 15_000 };
const resource = (f, bearer) => f.request('/resource', { headers: { authorization: `Bearer ${bearer}` } });
const details = (f, ticket, headers = { cookie: COOKIE }) =>
  f.request(`/api/oauth/consent?${new URLSearchParams({ request: ticket })}`, { headers });

test('real HTTP consent, PKCE, refresh and disconnect invalidate the whole grant', options, async (t) => {
  const f = await wireFixture(t);
  const flow = await begin(f);
  assert.equal(flow.location.pathname, '/consent-screen');
  assert.equal(flow.location.searchParams.has('code'), false);
  assert.ok(flow.ticket);
  const display = await details(f, flow.ticket);
  assert.equal(display.status, 200);
  assert.equal(display.headers.get('cache-control'), 'no-store');
  assert.equal(display.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(display.headers.get('x-frame-options'), 'DENY');
  const model = await display.json();
  assert.equal(model.accountEmail, 'owner@example.invalid');
  assert.equal(model.clientId, flow.clientId);
  assert.equal(model.redirectUri, CALLBACK);
  assert.deepEqual(model.scopes, ['mcp:read']);
  const form = await approve(f, flow, { cookie: RENEWED });
  assert.equal((await f.decision(flow.ticket)).status, 409);
  const exchanged = await f.token(form);
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  assert.equal((await f.token(form)).status, 400);
  assert.equal((await resource(f, tokens.access_token)).status, 200);
  assert.equal((await resource(f, await f.legacy())).status, 401);
  const refreshed = await f.token({ grant_type: 'refresh_token', client_id: flow.clientId,
    refresh_token: tokens.refresh_token });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.equal((await resource(f, tokens.access_token)).status, 200);
  assert.equal((await resource(f, next.access_token)).status, 200);
  const revoked = await f.request('/disconnect', { method: 'POST', headers: { cookie: COOKIE, origin: f.origin } });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).revokedRefreshTokens, 1);
  assert.equal((await resource(f, tokens.access_token)).status, 401);
  assert.equal((await resource(f, next.access_token)).status, 401);
  assert.equal((await f.token({ grant_type: 'refresh_token', client_id: flow.clientId,
    refresh_token: next.refresh_token })).status, 400);
  const reconnectConsent = await f.request(`/api/oauth/authorize?${flow.query}`, { headers: { cookie: COOKIE } });
  assert.equal(reconnectConsent.status, 302);
  const ticket = new URL(reconnectConsent.headers.get('location')).searchParams.get('request');
  const reconnect = await f.token(await approve(f, { ...flow, ticket }));
  assert.equal(reconnect.status, 200);
  assert.equal((await resource(f, (await reconnect.json()).access_token)).status, 200);
  assert.equal((await resource(f, tokens.access_token)).status, 401);
  assert.equal((await resource(f, next.access_token)).status, 401);
});

test('real HTTP denial is final and mints no code', options, async (t) => {
  const f = await wireFixture(t);
  const flow = await begin(f);
  const denied = await f.decision(flow.ticket, 'deny');
  assert.equal(denied.status, 200);
  const callback = new URL((await denied.json()).redirectUrl);
  assert.equal(callback.origin + callback.pathname, CALLBACK);
  assert.equal(callback.searchParams.get('error'), 'access_denied');
  assert.equal(callback.searchParams.get('state'), 'opaque-client-state');
  assert.equal(callback.searchParams.has('code'), false);
  assert.equal((await f.decision(flow.ticket)).status, 409);
  assert.equal((await resource(f, flow.ticket)).status, 401);
});

test('real HTTP consent rejects missing cookies, changed login and forged origin without consuming the ticket', options, async (t) => {
  const f = await wireFixture(t);
  const flow = await begin(f);
  assert.equal((await details(f, flow.ticket, { authorization: 'Bearer attacker', 'x-user': 'owner@example.invalid' })).status, 401);
  assert.equal((await details(f, flow.ticket, { cookie: RELOGIN })).status, 403);
  assert.equal((await f.decision(flow.ticket, 'approve', { cookie: RELOGIN })).status, 403);
  assert.equal((await f.decision(flow.ticket, 'approve', { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await f.decision(flow.ticket, 'approve', { origin: '' })).status, 403);
  assert.equal((await f.decision(flow.ticket, 'approve', { cookie: '' })).status, 401);
  const override = await f.request('/api/oauth/consent', {
    method: 'POST', headers: { cookie: COOKIE, origin: f.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ request: flow.ticket, decision: 'approve', email: 'attacker@example.invalid' }),
  });
  assert.equal(override.status, 400);
  assert.equal((await details(f, flow.ticket, { cookie: RENEWED })).status, 200);
  assert.equal((await f.token(await approve(f, flow))).status, 200);
  const anonymous = await begin(f, { authorization: 'Bearer attacker' });
  assert.equal(anonymous.location.pathname, '/login');
  assert.equal(anonymous.ticket, null);
});

test('real HTTP authorization preserves client eligibility and exact callback restrictions', options, async (t) => {
  const refused = await wireFixture(t, false);
  const ineligible = await begin(refused);
  assert.equal(ineligible.location.searchParams.get('error'), 'access_denied');
  assert.equal(ineligible.ticket, null);
  const f = await wireFixture(t);
  const flow = await begin(f);
  flow.query.set('redirect_uri', 'https://attacker.invalid/callback');
  const invalid = await f.request(`/api/oauth/authorize?${flow.query}`, { headers: { cookie: COOKIE } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('location'), null);
  assert.equal((await f.token(await approve(f, flow))).status, 200);
});
