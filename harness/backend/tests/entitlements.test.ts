/**
 * `@12-apps/entitlements` mounted the way a host mounts it — one
 * `entitlementsRouter` call over the published tarball — and driven through
 * the very app the SPA talks to.
 *
 * The plan read takes no permission and never 402s, the ask is a lead
 * (idempotent, gated on the package's own `plan:request`), and a denial
 * carries the machine body the browser half parses. The vocabulary and the
 * currency are a film festival's, so any default still answering a commercial
 * question shows up here in somebody else's words.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

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
    expect(plan.name).toBe('Shorts');
    expect(plan.price).toBe('Sem custo');
    expect(plan.comparison.map((tier) => [tier.key, tier.current])).toEqual([
      ['shorts', true],
      ['feature', false],
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
    expect(byKey['catalogue.print']).toMatchObject({
      reason: 'not-entitled',
      requiredPlan: 'feature',
      requiredPlanLabel: 'Feature',
    });
    // The tenant's own switch never does.
    expect(byKey['submissions.notes']).toMatchObject({
      reason: 'disabled-by-tenant',
      requiredPlan: null,
    });
    // Over quota (4 held against Shorts' 3): everything keeps working.
    expect(byKey['screeners.invited']?.note).toContain('Todos continuam ativos');
  });
});

describe('the plan-change ask', () => {
  it('is refused for a caller without `plan:request` — the button the SPA hides', async () => {
    const response = await backend.app.request(REQUEST_URL, {
      ...STAFF,
      method: 'POST',
      headers: { ...STAFF.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ requestedPlan: 'feature' }),
    });
    expect(response.status).toBe(403);
  });

  it('files ONE lead per tenant, however many times the button is pressed', async () => {
    const post = () =>
      backend.app.request(REQUEST_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedPlan: 'feature', feature: 'jury.deliberation' }),
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
    expect(body.request.requestedPlanKey).toBe('feature');
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
    const response = await backend.app.request('/api/admin/harness/jury-demo');
    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'entitlement_required',
      feature: 'jury.deliberation',
      reason: 'not-entitled',
      requiredPlan: 'feature',
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
    expect(snapshot.planKey).toBe('shorts');
    expect(snapshot.features['submissions.notes']?.reason).toBe('disabled-by-tenant');
  });
});

describe('adopted through @12-apps/wiring, not through the per-package adapter', () => {
  // `@12-apps/entitlements/hono` still works and is not deprecated. What it
  // cannot do is COUNT — and this package's manifest declares more than routes.

  it('accounts for every capability, with none unanswered', () => {
    const statuses = new Map(
      backend.entitlements.report.packages[0]?.capabilities.map((e) => [e.kind, e.status]),
    );

    expect(statuses.get('http')).toBe('bound');
    // Mandatory, with the reason in one line: "a refused plan change or a
    // failed retention sweep files under `entitlements`, not nowhere."
    // `entitlementsRouter` takes no logger argument, so the BINDER is the only
    // thing that can supply one.
    expect(statuses.get('observability')).toBe('bound');
    expect(statuses.get('db')).toBe('collected');
    // `unbound` is the status, and this line asserted `'unanswered'` — a string
    // no capability is ever given, so the check every one of these cases is
    // named for could not fail. The same shape of defect the contract exists to
    // catch, in the suite that checks the contract.
    expect([...statuses.values()]).not.toContain('unbound');
  });

  it('does not oblige this server host to answer for a React surface', () => {
    // The obligation this case guards is unchanged; what it asserts is now one
    // level more precise, because the manifest changed underneath it.
    //
    // It used to demand the capability be ABSENT, quoting the manifest's reason
    // for omitting `web`: "listing it would oblige every SERVER host adopting
    // this manifest to answer for a React surface it never mounts." That reason
    // was false. A capability declared for the OTHER runtime is answered
    // `out-of-scope` — the sibling web host answers for it — and `assemble()`
    // returns; only an APPLICABLE, unanswered capability is `unbound`. So the
    // omission bought nothing and cost the plan screens their only route to a
    // web host, which is why the manifest now declares them.
    //
    // The property that actually matters is the last line: nothing the web half
    // declares can leave this server host's assembly incomplete.
    const entries = backend.entitlements.report.packages[0]?.capabilities ?? [];
    const statuses = new Map(entries.map((entry) => [entry.kind, entry.status]));

    expect(statuses.get('surface')).toBe('out-of-scope');
    expect(statuses.get('areas')).toBe('out-of-scope');
    expect([...statuses.values()]).not.toContain('unbound');
  });

  it('names a descriptor this host forgot to claim', () => {
    const { routes } = backend.entitlements;
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} /api/admin/:tenantSlug${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.entitlements.report)).toContain('/api/admin/:tenantSlug');
  });
});
