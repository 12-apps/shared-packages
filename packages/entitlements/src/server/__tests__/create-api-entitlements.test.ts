// @vitest-environment node
/**
 * The API factory — the routes, the guards and the wire contract, driven
 * exactly the way an adapter drives them.
 *
 * The last block is the load-bearing one: the 402 body this half PRODUCES is
 * parsed by the react half's `upsellPromptFromPaymentRequired`. Both live in
 * this package so this test can hold the two ends of the wire together.
 */
import { describe, expect, it } from 'vitest';

import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import { createMemorySource } from '../../memory';
import { upsellPromptFromPaymentRequired } from '../../plan-wire';
import type { ComparisonTier, FiledPlanRequest, OpenPlanRequest } from '../../plan-wire';
import {
  createApiEntitlements,
  type ApiEntitlementsConfig,
  type EntitlementsRoute,
  type PlanChangeRequestPort,
} from '../create-api-entitlements';
import { entitlementDenialResponse, isEntitlementDenial } from '../wire';

const FEATURES = defineFeatures({
  'forecast.history': { onRevoke: 'hide', description: 'Histórico de previsões' },
  'alerts.digest': { onRevoke: 'readonly' },
  'stations.online': { kind: 'quota', onRevoke: 'readonly', description: 'Estações ativas' },
} as const);

const PLANS = definePlans(FEATURES, {
  hobby: { entitlements: { 'stations.online': 1 } },
  network: {
    extends: 'hobby',
    entitlements: { 'forecast.history': true, 'alerts.digest': true, 'stations.online': 5 },
  },
} as const);

type Feature = (typeof FEATURES.list)[number];
type PlanKey = (typeof PLANS.list)[number];

const PRICING = [
  { key: 'hobby', name: 'Hobby', priceCents: 0 },
  { key: 'network', name: 'Network', priceCents: 9900 },
];

/** The host's currency wording — required config since the BRL default left. */
const priceLabel = (cents: number | null): string | null =>
  cents === null ? null : `${(cents / 100).toFixed(2)} cr`;

const COMPARISON: ComparisonTier[] = [
  {
    key: 'network',
    name: 'Network',
    priceCents: 9900,
    price: '99.00 cr',
    priceNote: '/ciclo',
    pitch: 'Para redes com várias estações',
    headline: 'ilimitado',
    headlineUnit: 'estações',
    current: false,
    upgrade: true,
    recommended: true,
    sections: [],
  },
];

/** Every actor the read routes take — the write needs `plan:request` too. */
const READER = { tenantId: 't1', permissions: [] as readonly string[] };
const ASKER = { tenantId: 't1', permissions: ['plan:request'] as readonly string[] };

/** An in-memory lead store with the port's idempotency contract. */
function memoryLeads(): PlanChangeRequestPort & { rows: OpenPlanRequest[] } {
  const rows: OpenPlanRequest[] = [];
  const open = new Map<string, OpenPlanRequest>();
  const filed = (row: OpenPlanRequest): FiledPlanRequest => ({ id: row.id, status: 'open' });
  return {
    rows,
    async getOpen(tenantId) {
      return open.get(tenantId) ?? null;
    },
    async create(input) {
      const existing = open.get(input.tenantId);
      if (existing) return { request: filed(existing), created: false };
      const request: OpenPlanRequest = {
        id: `req-${rows.length + 1}`,
        requestedPlanKey: input.requestedPlanKey,
        createdAt: new Date(0).toISOString(),
      };
      open.set(input.tenantId, request);
      rows.push(request);
      return { request: filed(request), created: true };
    },
  };
}

/** A fresh source + surface per call — the hobby tenant `t1` pre-seeded. */
function build(over: Partial<ApiEntitlementsConfig<Feature, PlanKey>> = {}) {
  const source = createMemorySource<Feature>({
    t1: { plan: PLANS.get('hobby').entitlements, planKey: 'hobby' },
  });
  return {
    ...createApiEntitlements<Feature, PlanKey>({
      features: FEATURES,
      plans: PLANS,
      source,
      usage: { count: async () => 0 },
      defaultPlanKey: 'hobby',
      pricing: PRICING,
      formatPrice: priceLabel,
      comparison: () => COMPARISON,
      ...over,
    }),
    source,
  };
}

function route(api: { routes: EntitlementsRoute[] }, method: string, path: string) {
  const found = api.routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found;
}

/** Unwrap the `{ data: … }` SUCCESS envelope every 2xx body ships in. */
function dataOf<T>(response: { status: number; body: Record<string, unknown> }): T {
  expect(response.body.data).toBeDefined();
  return response.body.data as T;
}

describe('GET /plan', () => {
  it('serves the view plus the comparison, priced from the host catalog — enveloped', async () => {
    const api = build({ planChangeRequests: memoryLeads() });
    const response = await route(api, 'GET', '/plan').handle({ actor: READER });

    expect(response.status).toBe(200);
    // The envelope is the surface's contract: `{ data: { plan } }`, which the
    // packaged react half unwraps.
    expect(Object.keys(response.body)).toEqual(['data']);
    const plan = dataOf<{ plan: { name: string; price: string; comparison: unknown[] } }>(
      response,
    ).plan;
    expect(plan.name).toBe('Hobby');
    expect(plan.price).toBe('0.00 cr');
    expect(plan.comparison).toEqual(COMPARISON);
  });

  it('words the price through the host formatter and holds no currency of its own', async () => {
    const api = build({
      formatPrice: (cents) => (cents === null ? null : `USD ${(cents / 100).toFixed(2)}`),
    });
    const response = await route(api, 'GET', '/plan').handle({ actor: READER });
    expect(dataOf<{ plan: { price: string } }>(response).plan.price).toBe('USD 0.00');
  });

  it('names the required tier COMMERCIALLY on a denied row', async () => {
    const api = build();
    const response = await route(api, 'GET', '/plan').handle({ actor: READER });
    const plan = dataOf<{
      plan: { features: { feature: string; requiredPlan: string | null; requiredPlanLabel: string | null }[] };
    }>(response).plan;
    const history = plan.features.find((f) => f.feature === 'forecast.history');
    expect(history).toMatchObject({ requiredPlan: 'network', requiredPlanLabel: 'Network' });
  });

  it('measures live usage for enabled quota rows through the usage port', async () => {
    const api = build({ usage: { count: async () => 4 } });
    const response = await route(api, 'GET', '/plan').handle({ actor: READER });
    const plan = dataOf<{ plan: { features: { feature: string; used: number | null; note: string }[] } }>(
      response,
    ).plan;
    const locations = plan.features.find((f) => f.feature === 'stations.online');
    // used 4 > limit 1: the over-quota state, upselling the tier whose
    // ceiling clears what the tenant HOLDS.
    expect(locations?.used).toBe(4);
    expect(locations?.note).toContain('Todos continuam ativos');
    expect(locations?.note).toContain('Network');
  });
});

describe('GET /entitlements', () => {
  it('serves the server-resolved snapshot the provider renders from', async () => {
    const api = build();
    const response = await route(api, 'GET', '/entitlements').handle({ actor: READER });
    expect(response.status).toBe(200);
    const snapshot = dataOf<{ snapshot: { planKey: string; features: object } }>(response).snapshot;
    expect(snapshot.planKey).toBe('hobby');
    expect(Object.keys(snapshot.features)).toEqual([...FEATURES.list]);
  });
});

describe('POST /plan/request', () => {
  it('does not exist at all without the lead port — no billing, no route', () => {
    const api = build();
    expect(api.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /entitlements',
      'GET /plan',
    ]);
  });

  it('refuses a caller who does not hold `plan:request`', async () => {
    const api = build({ planChangeRequests: memoryLeads() });
    const response = await route(api, 'POST', '/plan/request').handle({
      actor: READER,
      body: { requestedPlan: 'network' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a plan key the ladder does not declare', async () => {
    const api = build({ planChangeRequests: memoryLeads() });
    const response = await route(api, 'POST', '/plan/request').handle({
      actor: ASKER,
      body: { requestedPlan: 'enterprise-mega' },
    });
    expect(response.status).toBe(400);
  });

  it('files the lead with the CURRENT plan resolved server-side, and is idempotent', async () => {
    const leads = memoryLeads();
    const api = build({ planChangeRequests: leads });
    const post = route(api, 'POST', '/plan/request');
    const actor = { ...ASKER, userId: 'u1' };

    const first = await post.handle({ actor, body: { requestedPlan: 'network', feature: 'forecast.history' } });
    expect(first.status).toBe(200);
    // The write answers `{ id, status }` — the lead's details live on the
    // read next door.
    expect(first.body).toEqual({
      data: { request: { id: 'req-1', status: 'open' }, created: true },
    });

    // A repeat press is one request, not two — and still a 200: "we already
    // have your request" is simply true.
    const second = await post.handle({ actor, body: { requestedPlan: 'network' } });
    expect(second.status).toBe(200);
    expect(dataOf<{ created: boolean }>(second).created).toBe(false);
    expect(leads.rows).toHaveLength(1);

    const open = await route(api, 'GET', '/plan/request').handle({ actor });
    expect(dataOf<{ request: OpenPlanRequest }>(open).request.requestedPlanKey).toBe('network');
  });

  it('validates the ask: trim, then length ceilings', async () => {
    const leads = memoryLeads();
    const api = build({ planChangeRequests: leads });
    const post = route(api, 'POST', '/plan/request');
    const actor = ASKER;

    // Whitespace is trimmed, not refused — `" network"` is an ask for network.
    const padded = await post.handle({ actor, body: { requestedPlan: ' network ', note: '  ' } });
    expect(padded.status).toBe(200);
    expect(leads.rows[0]?.requestedPlanKey).toBe('network');

    // A present-but-blank feature and over-limit fields are 400s.
    for (const body of [
      { requestedPlan: 'network', feature: '   ' },
      { requestedPlan: 'network', feature: 'x'.repeat(121) },
      { requestedPlan: 'network', note: 'x'.repeat(1001) },
    ]) {
      const response = await post.handle({ actor: { ...actor, tenantId: 't1' }, body });
      expect(response.status).toBe(400);
    }
  });
});

describe('the denial wire — produced here, parsed by the react half', () => {
  async function denialOf(feature: Feature, tenant = 't1') {
    // `surface`, not `api`: the flakiness gate tracks helper-scope names, and
    // several tests bind `api` locally.
    const surface = build();
    try {
      await surface.requireEntitlement(tenant, feature);
      throw new Error('expected a denial');
    } catch (error) {
      if (!isEntitlementDenial(error)) throw error;
      return entitlementDenialResponse(error);
    }
  }

  it('answers 402 with the machine half beside the human sentence', async () => {
    const denial = await denialOf('forecast.history');
    expect(denial.status).toBe(402);
    expect(denial.body).toMatchObject({
      code: 'entitlement_required',
      feature: 'forecast.history',
      reason: 'not-entitled',
      requiredPlan: 'network',
    });
    expect(typeof denial.body.error).toBe('string');
  });

  it("maps the tenant's own switch to 409 — not a payment problem", async () => {
    const api = build();
    api.source.set('t1', {
      plan: PLANS.get('network').entitlements,
      planKey: 'network',
      settings: { 'forecast.history': false },
    });
    const denial = await api
      .requireEntitlement('t1', 'forecast.history')
      .then(() => {
        throw new Error('expected a denial');
      })
      .catch((error: unknown) => {
        if (!isEntitlementDenial(error)) throw error;
        return entitlementDenialResponse(error);
      });
    expect(denial.status).toBe(409);
    expect(denial.body.code).toBeUndefined();
  });

  it('round-trips into the upsell prompt the react half raises', async () => {
    const denial = await denialOf('forecast.history');
    const prompt = upsellPromptFromPaymentRequired(denial.status, denial.body);
    expect(prompt).toEqual({ feature: 'forecast.history', requiredPlan: 'network', reason: 'not-entitled' });
  });

  it('quota denials carry used/limit and parse as quota-exceeded', async () => {
    const api = build({ usage: { count: async () => 1 } });
    const denial = await api
      .requireQuota('t1', 'stations.online')
      .then(() => {
        throw new Error('expected a denial');
      })
      .catch((error: unknown) => {
        if (!isEntitlementDenial(error)) throw error;
        return entitlementDenialResponse(error);
      });
    expect(denial.status).toBe(402);
    const prompt = upsellPromptFromPaymentRequired(denial.status, denial.body);
    expect(prompt).toMatchObject({
      feature: 'stations.online',
      reason: 'quota-exceeded',
      quota: { used: 1, limit: 1 },
    });
    // The tier whose ceiling clears the current one — the honest upsell.
    expect(prompt?.requiredPlan).toBe('network');
  });

  it('never sells what no plan grants: everything-else parses to null', () => {
    expect(upsellPromptFromPaymentRequired(403, { code: 'entitlement_required' })).toBeNull();
    expect(upsellPromptFromPaymentRequired(402, { code: 'something_else', feature: 'x' })).toBeNull();
    expect(upsellPromptFromPaymentRequired(402, null)).toBeNull();
  });
});

describe('the usage-registry audit at build time', () => {
  it('refuses to build over a quota the host cannot count', () => {
    expect(() =>
      build({
        usage: {
          port: { count: async () => 0 },
          assertRegistered: (quotaFeatures) => {
            if (quotaFeatures.length > 0) throw new Error(`unregistered: ${quotaFeatures.join()}`);
          },
        },
      }),
    ).toThrow(/unregistered: stations.online/);
  });
});
