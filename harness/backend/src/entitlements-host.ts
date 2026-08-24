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
  entitlementDenialResponse,
  isEntitlementDenial,
  PLAN_REQUEST_PERMISSION,
  PT_BR_ENTITLEMENTS_MESSAGES,
  type ComparisonTier,
  type FiledPlanRequest,
  type OpenPlanRequest,
  type PlanChangeRequestPort,
} from '@12-apps/entitlements/server';
import { entitlementsManifest } from '@12-apps/entitlements/manifest';
import { entitlementsServerManifest } from '@12-apps/entitlements/manifest/server';
import type { MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/**
 * A film-festival submissions catalog — a domain this package has no
 * relationship with, and deliberately not the one it was extracted from. The
 * harness is the only place the PUBLISHED tarball is exercised, so if a
 * default in it still answers a commercial question, it shows up here in
 * somebody else's vocabulary.
 */
export const FEATURES = defineFeatures({
  'jury.deliberation': { onRevoke: 'hide', description: 'Sala de júri' },
  'catalogue.print': { onRevoke: 'readonly', description: 'Catálogo impresso' },
  'submissions.notes': { onRevoke: 'disable', description: 'Notas de curadoria' },
  'screeners.invited': { kind: 'quota', onRevoke: 'readonly', description: 'Curadores' },
} as const);

export type HarnessFeature = (typeof FEATURES.list)[number];

export const PLANS = definePlans(FEATURES, {
  shorts: {
    description: 'Shorts',
    entitlements: { 'submissions.notes': true, 'screeners.invited': 3 },
  },
  feature: {
    extends: 'shorts',
    description: 'Feature',
    entitlements: {
      'jury.deliberation': true,
      'catalogue.print': true,
      'screeners.invited': 'unlimited',
    },
  },
} as const);

export type HarnessPlan = (typeof PLANS.list)[number];

/** Pricing DISPLAY rows — the host's billing owns these numbers. */
const PRICING = [
  { key: 'shorts', name: 'Shorts', priceCents: 0 },
  { key: 'feature', name: 'Feature', priceCents: 9900 },
];

/**
 * The host's own money, worded by the host. The package used to ship a
 * formatter for one country's currency as the default, so a harness that said
 * nothing rendered that country's prices — which is precisely what the
 * consumer harness exists to catch.
 */
const formatPrice = (cents: number | null): string | null =>
  cents === null ? null : cents === 0 ? 'Sem custo' : `£${(cents / 100).toFixed(2)}`;

/** The tenant every spec drives. On Shorts, with notes switched off by choice. */
export const TENANT = 'harness';

function seededState() {
  return {
    plan: PLANS.get('shorts').entitlements,
    planKey: 'shorts',
    // The tenant's OWN switch: entitled to curation notes, turned them off —
    // the one denial the plan page must NOT sell an upgrade for.
    settings: { 'submissions.notes': false },
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
    // The interval is the HOST's too — the card used to append a hardcoded
    // monthly suffix of its own.
    priceNote: row.priceCents === 0 ? null : 'por edição',
    pitch: row.key === 'shorts' ? 'Para uma mostra pequena' : 'Para um festival com júri',
    headline: row.key === 'shorts' ? '3' : 'ilimitado',
    headlineUnit: 'curadores',
    current: row.key === currentPlanKey,
    upgrade: PRICING.findIndex((p) => p.key === row.key) >
      PRICING.findIndex((p) => p.key === currentPlanKey),
    recommended: row.key === 'feature',
    sections: [
      {
        title: 'Curadoria',
        lines: [
          { label: 'Notas de curadoria', included: true, detail: null },
          {
            label: 'Curadores',
            included: true,
            detail: row.key === 'shorts' ? 'até 3' : 'ilimitado',
          },
          { label: 'Sala de júri', included: row.key === 'feature', detail: null },
          { label: 'Catálogo impresso', included: row.key === 'feature', detail: null },
        ],
      },
    ],
  }));
}

/** Where `mount-surfaces.ts` hangs it — the adoption's claim. */
export const ENTITLEMENTS_MOUNT_PATH = '/api/admin/:tenantSlug';

export interface EntitlementsHost {
  router: Hono;
  engine: EntitlementsEngine<HarnessFeature>;
  requireEntitlement(tenantId: string, feature: HarnessFeature): Promise<void>;
  reset(): void;
  /** The consumer's account of what was bound, declined or left over. */
  report: WiringReport;
  routes: readonly MountedRoute[];
}

/**
 * The lead store — standing in for the host's own billing table.
 *
 * Idempotent by tenant, exactly the contract the port documents, and its own
 * function because it is the one part of this host that is genuinely a
 * DATABASE in a real adopter: everything around it is vocabulary.
 */
function createPlanChangeRequests(): {
  port: PlanChangeRequestPort;
  clear: () => void;
} {
  const open = new Map<string, OpenPlanRequest>();
  let sequence = 0;
  // The write answers `{ id, status }` only — the read next door carries the
  // details, exactly the split the port documents.
  const filed = (row: OpenPlanRequest): FiledPlanRequest => ({ id: row.id, status: 'open' });
  return {
    clear: () => open.clear(),
    port: {
      async getOpen(tenantId) {
        return open.get(tenantId) ?? null;
      },
      async create(input) {
        const existing = open.get(input.tenantId);
        if (existing) return { request: filed(existing), created: false };
        sequence += 1;
        const request: OpenPlanRequest = {
          id: `req-${sequence}`,
          requestedPlanKey: input.requestedPlanKey,
          createdAt: new Date().toISOString(),
        };
        open.set(input.tenantId, request);
        return { request: filed(request), created: true };
      },
    },
  };
}

/**
 * Everything `createApiEntitlements` requires, as one value.
 *
 * Its own function so the adoption above reads as the four lines it is, and
 * because this is the half a reader compares against the package's own list of
 * required config — the catalog, the ladder, the source, the pricing DISPLAY
 * data and the words — while everything around it is contract mechanics.
 */
function apiConfig(source: MemorySource<HarnessFeature>, planChangeRequests: PlanChangeRequestPort) {
  return {
    features: FEATURES,
    plans: PLANS,
    source,
    // The seeded tenant holds four curators against Shorts' ceiling of three —
    // the over-quota state: everything keeps working, inviting more upsells.
    usage: {
      count: async (_tenantId: string, feature: string) =>
        feature === 'screeners.invited' ? 4 : 0,
    },
    defaultPlanKey: 'shorts',
    pricing: PRICING,
    formatPrice,
    comparison,
    planChangeRequests,
    // The surface's sentences, passed by hand — required config, exactly like
    // `formatPrice`: the package no longer ships a default voice.
    messages: PT_BR_ENTITLEMENTS_MESSAGES,
  };
}

export function createEntitlementsHost(): EntitlementsHost {
  const source: MemorySource<HarnessFeature> = createMemorySource({
    [TENANT]: seededState(),
  });
  const leads = createPlanChangeRequests();

  /**
   * The surface, adopted through `@12-apps/wiring/consumer` rather than through
   * `@12-apps/entitlements/hono`.
   *
   * The per-package Hono adapter still works and is not deprecated — what it
   * cannot do is COUNT. This package declares `http`, `db` and a MANDATORY
   * `observability` namespace whose reason it states in one line ("a refused
   * plan change or a failed retention sweep files under `entitlements`, not
   * nowhere"), and `entitlementsRouter` takes no logger argument: the binder is
   * the only thing that can supply one.
   *
   * Its manifest is also the clearest statement in the repo of why an inventory
   * must not overstate — it deliberately omits `web` even though `./react`
   * ships the plan screens, "because listing it would oblige every SERVER host
   * adopting this manifest to answer for a React surface it never mounts."
   * Answering that manifest here is therefore a complete answer, not a partial
   * one.
   */
  const wiring = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });

  wiring.adoptServer({
    manifest: entitlementsManifest,
    server: entitlementsServerManifest,
    bindings: { http: { mountPath: ENTITLEMENTS_MOUNT_PATH, config: apiConfig(source, leads.port) } },
  });

  const wired = wiring.assemble();
  // Each package's FULL `http.create` result, which the aggregate hands back
  // keyed by package name — this is how a host keeps the engine and the guard
  // it needs beside the routes, without building the surface twice.
  const api = wired.http[entitlementsManifest.name] as {
    engine: EntitlementsEngine<HarnessFeature>;
    requireEntitlement(tenantId: string, feature: HarnessFeature): Promise<void>;
  };

  const router = honoRouterFor(wired.routes, (c) => {
    // The host's whole authentication story, reduced to a header the specs can
    // set: `x-harness-role: staff` is a caller the WRITE refuses. The id it
    // grants is the PACKAGE's own contribution, composed into what this host
    // would otherwise call its catalog.
    const role = c.req.header('x-harness-role') ?? 'admin';
    return {
      tenantId: TENANT,
      userId: 'user-harness',
      permissions: role === 'admin' ? [PLAN_REQUEST_PERMISSION] : [],
    };
  });

  return {
    router,
    engine: api.engine,
    requireEntitlement: (tenantId, feature) => api.requireEntitlement(tenantId, feature),
    report: wired.report,
    routes: wired.routes,
    reset() {
      leads.clear();
      source.set(TENANT, seededState());
    },
  };
}

/**
 * A HOST endpoint standing behind the package's guard — the arrangement every
 * gated host route has. What it proves is the denial WIRE: the free tenant answers
 * 402 here with the body the react half's 402 interceptor parses into an upsell
 * prompt.
 */
export function mountEntitlementDemo(app: Hono, entitlements: EntitlementsHost): void {
  app.get('/api/admin/:tenantSlug/jury-demo', async (c) => {
    try {
      await entitlements.requireEntitlement(TENANT, 'jury.deliberation');
      return c.json({ entries: [] });
    } catch (error) {
      if (!isEntitlementDenial(error)) throw error;
      const denial = entitlementDenialResponse(error, PT_BR_ENTITLEMENTS_MESSAGES);
      return c.json(denial.body, denial.status as 402);
    }
  });
}
