/**
 * `@12-apps/entitlements` mounted the way a host mounts it — one
 * `entitlementsRouter` call over the published tarball — and driven through
 * the very app the SPA talks to.
 *
 * Ported from future-pay's plan-route and entitlement-wire coverage: the plan
 * read is staff-wide and never 402s, the ask is a lead (idempotent, admin
 * gated), and a denial carries the machine body the browser half parses.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';

let backend: HarnessBackend;

beforeEach(async () => {
  backend ??= await createHarnessBackend();
  await backend.app.request('/__harness/reset', { method: 'POST' });
});

const PLAN_URL = '/api/admin/harness/plan';
const REQUEST_URL = '/api/admin/harness/plan/request';
const STAFF = { headers: { 'x-harness-role': 'staff' } };

describe('GET /plan', () => {
  it('answers every staff member — the screen that explains denials is never itself denied', async () => {
    const response = await backend.app.request(PLAN_URL, STAFF);
    expect(response.status).toBe(200);
    // The `{ data: … }` SUCCESS envelope is the surface's contract — the
    // same invariant the host documents for its whole /api/admin/** surface.
    const envelope = (await response.json()) as {
      data: {
        plan: {
          name: string;
          price: string;
          comparison: { key: string; current: boolean; name: string }[];
        };
      };
    };
    const { plan } = envelope.data;
    expect(plan.name).toBe('Gratuito');
    expect(plan.price).toBe('Grátis');
    expect(plan.comparison.map((tier) => [tier.key, tier.current])).toEqual([
      ['free', true],
      ['pro', false],
    ]);
  });

  it('words each denial for a customer, with the COMMERCIAL tier name on the upsell', async () => {
    const response = await backend.app.request(PLAN_URL);
    const { plan } = ((await response.json()) as {
      data: {
        plan: {
          features: {
            feature: string;
            reason: string;
            requiredPlan: string | null;
            requiredPlanLabel: string | null;
            note: string;
          }[];
        };
      };
    }).data;
    const byKey = Object.fromEntries(plan.features.map((f) => [f.feature, f]));

    // A plan gap upsells, commercially named.
    expect(byKey['branding.white_label']).toMatchObject({
      reason: 'not-entitled',
      requiredPlan: 'pro',
      requiredPlanLabel: 'Pro',
    });
    // The tenant's own switch never does.
    expect(byKey['storefront.tables']).toMatchObject({
      reason: 'disabled-by-tenant',
      requiredPlan: null,
    });
    // Over quota (4 held against free's 3): everything keeps working.
    expect(byKey['stock.locations']?.note).toContain('Todos continuam ativos');
  });
});

describe('the plan-change ask', () => {
  it('is refused for a caller the host did not clear — the button the SPA hides', async () => {
    const response = await backend.app.request(REQUEST_URL, {
      ...STAFF,
      method: 'POST',
      headers: { ...STAFF.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ requestedPlan: 'pro' }),
    });
    expect(response.status).toBe(403);
  });

  it('files ONE lead per store, however many times the button is pressed', async () => {
    const post = () =>
      backend.app.request(REQUEST_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedPlan: 'pro', feature: 'audit' }),
      });

    const first = ((await (await post()).json()) as {
      data: { created: boolean; request: { id: string; status: string } };
    }).data;
    expect(first.created).toBe(true);
    // The write answers `{ id, status }` — details live on the read.
    expect(first.request).toEqual({ id: first.request.id, status: 'open' });
    const second = ((await (await post()).json()) as {
      data: { created: boolean; request: { id: string } };
    }).data;
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);

    // Staff can SEE the open ask — nobody is invited to ask again.
    const open = await backend.app.request(REQUEST_URL, STAFF);
    const body = ((await open.json()) as {
      data: { request: { requestedPlanKey: string } };
    }).data;
    expect(body.request.requestedPlanKey).toBe('pro');
  });

  it('rejects a tier the ladder does not declare', async () => {
    const response = await backend.app.request(REQUEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestedPlan: 'enterprise-mega' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('the denial wire on a gated HOST route', () => {
  it('answers 402 with the machine body the browser interceptor parses', async () => {
    const response = await backend.app.request('/api/admin/harness/audit-demo');
    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'entitlement_required',
      feature: 'audit',
      reason: 'not-entitled',
      requiredPlan: 'pro',
    });
    // The human sentence rides beside the machine half, never replaced by it.
    expect(typeof body.error).toBe('string');
  });
});

describe('the snapshot bootstrap', () => {
  it('serves the server-resolved snapshot the provider renders from', async () => {
    const response = await backend.app.request('/api/admin/harness/entitlements');
    expect(response.status).toBe(200);
    const { snapshot } = ((await response.json()) as {
      data: { snapshot: { planKey: string; features: Record<string, { reason: string }> } };
    }).data;
    expect(snapshot.planKey).toBe('free');
    expect(snapshot.features['storefront.tables']?.reason).toBe('disabled-by-tenant');
  });
});
