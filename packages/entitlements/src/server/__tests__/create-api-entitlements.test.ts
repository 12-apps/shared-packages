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
import type { ComparisonTier, OpenPlanRequest } from '../../plan-wire';
import {
  createApiEntitlements,
  type ApiEntitlementsConfig,
  type EntitlementsRoute,
  type PlanChangeRequestPort,
} from '../create-api-entitlements';
import { entitlementDenialResponse, isEntitlementDenial } from '../wire';

const FEATURES = defineFeatures({
  audit: { onRevoke: 'hide', description: 'Registro de atividades' },
  'branding.white_label': { onRevoke: 'readonly' },
  'stock.locations': { kind: 'quota', onRevoke: 'readonly', description: 'Locais de estoque' },
} as const);

const PLANS = definePlans(FEATURES, {
  free: { entitlements: { 'stock.locations': 1 } },
  pro: {
    extends: 'free',
    entitlements: { audit: true, 'branding.white_label': true, 'stock.locations': 5 },
  },
} as const);

type Feature = (typeof FEATURES.list)[number];

const PRICING = [
  { key: 'free', name: 'Gratuito', priceCents: 0 },
  { key: 'pro', name: 'Pro', priceCents: 9900 },
];

const COMPARISON: ComparisonTier[] = [
  {
    key: 'pro',
    name: 'Pro',
    priceCents: 9900,
    price: 'R$ 99,00',
    pitch: 'Para lojas com salão',
    headline: 'ilimitado',
    headlineUnit: 'produtos',
    current: false,
    upgrade: true,
    recommended: true,
    sections: [],
  },
];

/** An in-memory lead store with the port's idempotency contract. */
function memoryLeads(): PlanChangeRequestPort & { rows: OpenPlanRequest[] } {
  const rows: OpenPlanRequest[] = [];
  const open = new Map<string, OpenPlanRequest>();
  return {
    rows,
    async getOpen(tenantId) {
      return open.get(tenantId) ?? null;
    },
    async create(input) {
      const existing = open.get(input.tenantId);
      if (existing) return { request: existing, created: false };
      const request: OpenPlanRequest = {
        id: `req-${rows.length + 1}`,
        requestedPlanKey: input.requestedPlanKey,
        createdAt: new Date(0).toISOString(),
      };
      open.set(input.tenantId, request);
      rows.push(request);
      return { request, created: true };
    },
  };
}

/** A fresh source + surface per call — the free tenant `t1` pre-seeded. */
function build(over: Partial<ApiEntitlementsConfig<Feature>> = {}) {
  const source = createMemorySource<Feature>({
    t1: { plan: PLANS.get('free').entitlements, planKey: 'free' },
  });
  return {
    ...createApiEntitlements<Feature>({
      features: FEATURES,
      plans: PLANS,
      source,
      usage: { count: async () => 0 },
      defaultPlanKey: 'free',
      pricing: PRICING,
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

describe('GET /plan', () => {
  it('serves the view plus the comparison, priced from the host catalog', async () => {
    const api = build({ planChangeRequests: memoryLeads() });
    const response = await route(api, 'GET', '/plan').handle({ actor: { tenantId: 't1' } });

    expect(response.status).toBe(200);
    const plan = (response.body as { plan: { name: string; price: string; comparison: unknown[] } })
      .plan;
    expect(plan.name).toBe('Gratuito');
    expect(plan.price).toBe('Grátis');
    expect(plan.comparison).toEqual(COMPARISON);
  });

  it('names the required tier COMMERCIALLY on a denied row', async () => {
    const api = build();
    const response = await route(api, 'GET', '/plan').handle({ actor: { tenantId: 't1' } });
    const plan = (
      response.body as {
        plan: { features: { feature: string; requiredPlan: string | null; requiredPlanLabel: string | null }[] };
      }
    ).plan;
    const audit = plan.features.find((f) => f.feature === 'audit');
    expect(audit).toMatchObject({ requiredPlan: 'pro', requiredPlanLabel: 'Pro' });
  });

  it('measures live usage for enabled quota rows through the usage port', async () => {
    const api = build({ usage: { count: async () => 4 } });
    const response = await route(api, 'GET', '/plan').handle({ actor: { tenantId: 't1' } });
    const plan = (
      response.body as { plan: { features: { feature: string; used: number | null; note: string }[] } }
    ).plan;
    const locations = plan.features.find((f) => f.feature === 'stock.locations');
    // used 4 > limit 1: the over-quota state, upselling the tier whose
    // ceiling clears what the store HOLDS.
    expect(locations?.used).toBe(4);
    expect(locations?.note).toContain('Todos continuam ativos');
    expect(locations?.note).toContain('Pro');
  });
});

describe('GET /entitlements', () => {
  it('serves the server-resolved snapshot the provider renders from', async () => {
    const api = build();
    const response = await route(api, 'GET', '/entitlements').handle({ actor: { tenantId: 't1' } });
    expect(response.status).toBe(200);
    const snapshot = (response.body as { snapshot: { planKey: string; features: object } }).snapshot;
    expect(snapshot.planKey).toBe('free');
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

  it('refuses a caller the host did not clear for the write', async () => {
    const api = build({ planChangeRequests: memoryLeads() });
    const response = await route(api, 'POST', '/plan/request').handle({
      actor: { tenantId: 't1', canRequestPlanChange: false },
      body: { requestedPlan: 'pro' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a plan key the ladder does not declare', async () => {
    const api = build({ planChangeRequests: memoryLeads() });
    const response = await route(api, 'POST', '/plan/request').handle({
      actor: { tenantId: 't1', canRequestPlanChange: true },
      body: { requestedPlan: 'enterprise-mega' },
    });
    expect(response.status).toBe(400);
  });

  it('files the lead with the CURRENT plan resolved server-side, and is idempotent', async () => {
    const leads = memoryLeads();
    const api = build({ planChangeRequests: leads });
    const post = route(api, 'POST', '/plan/request');
    const actor = { tenantId: 't1', userId: 'u1', canRequestPlanChange: true };

    const first = await post.handle({ actor, body: { requestedPlan: 'pro', feature: 'audit' } });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: true });

    // A repeat press is one request, not two — and still a 200: "we already
    // have your request" is simply true.
    const second = await post.handle({ actor, body: { requestedPlan: 'pro' } });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ created: false });
    expect(leads.rows).toHaveLength(1);

    const open = await route(api, 'GET', '/plan/request').handle({ actor });
    expect((open.body as { request: OpenPlanRequest }).request.requestedPlanKey).toBe('pro');
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
    const denial = await denialOf('audit');
    expect(denial.status).toBe(402);
    expect(denial.body).toMatchObject({
      code: 'entitlement_required',
      feature: 'audit',
      reason: 'not-entitled',
      requiredPlan: 'pro',
    });
    expect(typeof denial.body.error).toBe('string');
  });

  it("maps the tenant's own switch to 409 — not a payment problem", async () => {
    const api = build();
    api.source.set('t1', {
      plan: PLANS.get('pro').entitlements,
      planKey: 'pro',
      settings: { audit: false },
    });
    const denial = await api
      .requireEntitlement('t1', 'audit')
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
    const denial = await denialOf('audit');
    const prompt = upsellPromptFromPaymentRequired(denial.status, denial.body);
    expect(prompt).toEqual({ feature: 'audit', requiredPlan: 'pro', reason: 'not-entitled' });
  });

  it('quota denials carry used/limit and parse as quota-exceeded', async () => {
    const api = build({ usage: { count: async () => 1 } });
    const denial = await api
      .requireQuota('t1', 'stock.locations')
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
      feature: 'stock.locations',
      reason: 'quota-exceeded',
      quota: { used: 1, limit: 1 },
    });
    // The tier whose ceiling clears the current one — the honest upsell.
    expect(prompt?.requiredPlan).toBe('pro');
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
    ).toThrow(/unregistered: stock.locations/);
  });
});
