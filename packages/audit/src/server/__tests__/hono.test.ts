/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   same as routes.test.ts beside it: the seam is the in-memory fake, built fresh
   by `mounted()` inside every case, so the names the rules key on are not a
   database and the locals they flag are not shared. */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { auditRouter } from '../../hono/index';
import { getActorAttribution, getActorUserId } from '../actor-context';

import { fakeAuditDb } from './fake-db';
import { TEST_VOCABULARY } from './fixtures';
import { DEFAULT_MESSAGES } from '../config';

/**
 * The Hono adapter (12-14) — mounted the way a host mounts it, and driven through
 * `app.request()` so the assertions are about real HTTP: the URL, the status and
 * the body a consumer receives.
 *
 * `hono` is an OPTIONAL peer, and this is the only suite that imports it. Nothing
 * under `.` or `./server` may, or a host that wants the React viewer alone would
 * have to install a server framework.
 */
const TENANT = 'client-1';

function mounted(options: { permissions?: string[] } = {}) {
  const fake = fakeAuditDb();
  const audit = auditRouter({
    db: () => Promise.resolve(fake.db),
    // The slug is the HOST's to resolve; the adapter hands it over in `params` and
    // the descriptors never read it.
    resolveActor: (request) => ({
      tenantId: request.params.tenantSlug === 'my-store' ? TENANT : 'other',
      userId: 'u-owner',
      permissions: options.permissions ?? ['audit:read'],
      role: 'OWNER',
      scope: TENANT,
      onBehalfOfUserId: request.header('x-preview-as') ?? null,
    }),
    vocabulary: TEST_VOCABULARY,
    directory: {
      getUsers: (ids) => Promise.resolve(ids.map((id) => ({ id, name: `Name ${id}` }))),
      listActors: () => Promise.resolve([{ id: 'u-owner', name: 'Ana' }]),
    },
  });
  const app = new Hono();
  app.use('*', audit.actorContext);
  app.route('/api/admin/:tenantSlug', audit.router);
  return { app, fake, audit };
}

describe('the mounted router', () => {
  it('serves the trail under the host mount, tenant-scoped', async () => {
    const { app, fake } = mounted();
    fake.seed({ clientId: TENANT, resourceId: 'mine' }, { clientId: 'other', resourceId: 'theirs' });

    const response = await app.request('/api/admin/my-store/audit-logs');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { resourceId: string }[]; pagination: unknown };
    expect(body.data.map((entry) => entry.resourceId)).toEqual(['mine']);
    // The page's totals ride WITH the page: `{ data, pagination }` unwrapped.
    expect(body.pagination).toMatchObject({ total: 1, page: 1 });
  });

  it('routes /audit-logs/actors to the actors route, not into the listing', async () => {
    const { app } = mounted();

    const response = await app.request('/api/admin/my-store/audit-logs/actors');

    expect(response.status).toBe(200);
    // A success that is not a page is `{ data }`.
    expect(await response.json()).toEqual({ data: [{ id: 'u-owner', label: 'Ana' }] });
  });

  it('answers a denial as { error } at the TOP level, with the handler status', async () => {
    // Never wrapped in `data`: an interceptor that unwraps `data` blindly would
    // otherwise turn an error body into a value.
    const { app } = mounted({ permissions: [] });

    const response = await app.request('/api/admin/my-store/audit-logs');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: DEFAULT_MESSAGES.forbidden });
  });

  it('answers 400 for a malformed filter', async () => {
    const { app } = mounted();

    const response = await app.request('/api/admin/my-store/audit-logs?from=nope');

    expect(response.status).toBe(400);
  });

  it('forwards the query string to the filters', async () => {
    const { app, fake } = mounted();
    fake.seed(
      { clientId: TENANT, resourceId: 'kept', action: 'lamp.extinguish' },
      { clientId: TENANT, resourceId: 'dropped', action: 'supply.deliver' },
    );

    const response = await app.request(
      '/api/admin/my-store/audit-logs?action_in=lamp.extinguish',
    );

    const body = (await response.json()) as { data: { resourceId: string }[] };
    expect(body.data.map((entry) => entry.resourceId)).toEqual(['kept']);
  });

  it('resolves a different tenant for a different slug', async () => {
    const { app, fake } = mounted();
    fake.seed({ clientId: 'other', resourceId: 'theirs' });

    const response = await app.request('/api/admin/their-store/audit-logs');

    const body = (await response.json()) as { data: { resourceId: string }[] };
    expect(body.data.map((entry) => entry.resourceId)).toEqual(['theirs']);
  });
});

describe('the actor-context middleware', () => {
  it('stamps the request actor for every route the host mounts after it', async () => {
    const { app, audit } = mounted();
    // A CONTAINER whose property the handler sets, not a closed-over binding it
    // reassigns: the latter is the pattern the flakiness gate rejects, because a
    // handler that never ran leaves the previous value standing.
    const seen: {
      value?: { userId?: string; realUserId?: string | null; subject?: string | null };
    } = {};
    app.get('/api/admin/:tenantSlug/host-write', (c) => {
      const attribution = getActorAttribution();
      seen.value = {
        userId: getActorUserId(),
        realUserId: attribution.realUserId,
        subject: attribution.onBehalfOfUserId,
      };
      return c.json({ ok: true });
    });

    await app.request('/api/admin/my-store/host-write', {
      headers: { 'x-preview-as': 'u-target' },
    });

    // The pair travels: the host route's own writes would be attributed to the
    // real human, with the subject recorded beside them.
    expect(seen.value).toEqual({ userId: 'u-owner', realUserId: 'u-owner', subject: 'u-target' });
    expect(audit.routes).toHaveLength(2);
  });

  it('leaves no actor behind once the request is done', async () => {
    const { app } = mounted();

    await app.request('/api/admin/my-store/audit-logs');

    expect(getActorUserId()).toBeUndefined();
  });
});
