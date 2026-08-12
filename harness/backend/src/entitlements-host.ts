/**
 * The host wiring a backend performs for `@12-apps/entitlements` — and nothing
 * more: a feature catalog, a plan ladder, a source, pricing DISPLAY data, and
 * the plan-change lead store. Everything served under `/plan` and
 * `/entitlements` — parsing, envelopes, status codes, the 402-vs-409-vs-404
 * denial mapping — is the package's.
 *
 * The money boundary, demonstrated: this host owns the lead rows (the
 * `PlanChangeRequestPort` writes into a plain array standing in for the
 * host's own billing table) and the pricing strings. The package never sees a
 * charge, a provider or a tier write.
 */
import type { Hono } from 'hono';
import {
  createEntitlements,
  createMemorySource,
  defineFeatures,
  definePlans,
  type EntitlementsEngine,
  type MemorySource,
} from '@12-apps/entitlements';
import {
  formatPrice,
  type ComparisonTier,
  type OpenPlanRequest,
  type PlanChangeRequestPort,
} from '@12-apps/entitlements/server';
import { entitlementsRouter } from '@12-apps/entitlements/hono';

export const FEATURES = defineFeatures({
  audit: { onRevoke: 'hide', description: 'Registro de atividades' },
  'branding.white_label': { onRevoke: 'readonly', description: 'Marca própria' },
  'storefront.tables': { onRevoke: 'disable', description: 'Mesas e comandas' },
  'stock.locations': { kind: 'quota', onRevoke: 'readonly', description: 'Locais de estoque' },
} as const);

export type HarnessFeature = (typeof FEATURES.list)[number];

export const PLANS = definePlans(FEATURES, {
  free: {
    description: 'Gratuito',
    entitlements: { 'storefront.tables': true, 'stock.locations': 3 },
  },
  pro: {
    extends: 'free',
    description: 'Pro',
    entitlements: {
      audit: true,
      'branding.white_label': true,
      'stock.locations': 'unlimited',
    },
  },
} as const);

/** Pricing DISPLAY rows — the host's billing owns these numbers. */
const PRICING = [
  { key: 'free', name: 'Gratuito', priceCents: 0 },
  { key: 'pro', name: 'Pro', priceCents: 9900 },
];

/** The tenant every spec drives. On free, with mesas switched off by choice. */
export const TENANT = 'harness';

function seededState() {
  return {
    plan: PLANS.get('free').entitlements,
    planKey: 'free',
    // The tenant's OWN switch: entitled to mesas, turned them off — the one
    // denial the plan page must NOT sell an upgrade for.
    settings: { 'storefront.tables': false },
  };
}

/**
 * The pricing cards, assembled by the HOST (a real one derives them from its
 * billing catalog). Every card renders the same sections in the same order so
 * a row means the same thing across the grid.
 */
function comparison(currentPlanKey: string): ComparisonTier[] {
  return PRICING.map((row) => ({
    key: row.key,
    name: row.name,
    priceCents: row.priceCents,
    price: formatPrice(row.priceCents),
    pitch: row.key === 'free' ? 'Para começar a vender' : 'Para lojas com salão e auditoria',
    headline: row.key === 'free' ? '3' : 'ilimitado',
    headlineUnit: 'locais de estoque',
    current: row.key === currentPlanKey,
    upgrade: PRICING.findIndex((p) => p.key === row.key) >
      PRICING.findIndex((p) => p.key === currentPlanKey),
    recommended: row.key === 'pro',
    sections: [
      {
        title: 'Loja',
        lines: [
          { label: 'Mesas e comandas', included: true, detail: null },
          {
            label: 'Locais de estoque',
            included: true,
            detail: row.key === 'free' ? 'até 3' : 'ilimitado',
          },
          { label: 'Registro de atividades', included: row.key === 'pro', detail: null },
          { label: 'Marca própria', included: row.key === 'pro', detail: null },
        ],
      },
    ],
  }));
}

export interface EntitlementsHost {
  router: Hono;
  engine: EntitlementsEngine<HarnessFeature>;
  requireEntitlement(tenantId: string, feature: HarnessFeature): Promise<void>;
  reset(): void;
}

export function createEntitlementsHost(): EntitlementsHost {
  const source: MemorySource<HarnessFeature> = createMemorySource({
    [TENANT]: seededState(),
  });

  // The lead store — standing in for the host's own billing table. Idempotent
  // by tenant, exactly the contract the port documents.
  const open = new Map<string, OpenPlanRequest>();
  let sequence = 0;
  const planChangeRequests: PlanChangeRequestPort = {
    async getOpen(tenantId) {
      return open.get(tenantId) ?? null;
    },
    async create(input) {
      const existing = open.get(input.tenantId);
      if (existing) return { request: existing, created: false };
      sequence += 1;
      const request: OpenPlanRequest = {
        id: `req-${sequence}`,
        requestedPlanKey: input.requestedPlanKey,
        createdAt: new Date().toISOString(),
      };
      open.set(input.tenantId, request);
      return { request, created: true };
    },
  };

  const { app: router, api } = entitlementsRouter<HarnessFeature>({
    features: FEATURES,
    plans: PLANS,
    source,
    // The seeded store holds four locations against free's ceiling of three —
    // the over-quota state: everything keeps working, creating more upsells.
    usage: { count: async (_tenantId, feature) => (feature === 'stock.locations' ? 4 : 0) },
    defaultPlanKey: 'free',
    pricing: PRICING,
    comparison,
    planChangeRequests,
    resolveActor: (c) => {
      // The host's whole authentication story, reduced to a header the specs
      // can set: `x-harness-role: staff` is a caller the WRITE refuses.
      const role = c.req.header('x-harness-role') ?? 'admin';
      return {
        tenantId: TENANT,
        userId: 'user-harness',
        canRequestPlanChange: role === 'admin',
      };
    },
  });

  return {
    router,
    engine: api.engine,
    requireEntitlement: (tenantId, feature) => api.requireEntitlement(tenantId, feature),
    reset() {
      open.clear();
      source.set(TENANT, seededState());
    },
  };
}
