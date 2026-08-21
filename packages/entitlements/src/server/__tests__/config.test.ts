// @vitest-environment node
/**
 * The assembly check — every rule here used to be a DEFAULT, an optional
 * field, or nothing at all.
 *
 * The lesson these tests encode is that a required-but-unvalidated option is
 * still fail-open. Making a field required moves the failure from "wrong
 * answer, silently" to "type error" only for hosts on TypeScript, only when
 * they build, and only for the shapes the type describes — an EMPTY collection
 * satisfies every one of those and still answers the question wrongly.
 */
import { describe, expect, it } from 'vitest';

import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import type { FeatureRegistry, ResolvedFeatureDef } from '../../core/types';
import { createMemorySource } from '../../memory';
import { createApiEntitlements } from '../create-api-entitlements';
import { PT_BR_ENTITLEMENTS_MESSAGES } from '../pt-BR';
import { EntitlementsConfigError } from '../config';
import type { ApiEntitlementsConfig } from '../config';

const FEATURES = defineFeatures({
  'forecast.history': { onRevoke: 'hide' },
  'stations.online': { kind: 'quota', onRevoke: 'readonly' },
} as const);

type Feature = (typeof FEATURES.list)[number];

const PLANS = definePlans(FEATURES, {
  hobby: { entitlements: { 'stations.online': 1 } },
  network: { extends: 'hobby', entitlements: { 'forecast.history': true } },
} as const);

type PlanKey = (typeof PLANS.list)[number];

const PRICING = [
  { key: 'hobby', name: 'Hobby', priceCents: 0 },
  { key: 'network', name: 'Network', priceCents: 9900 },
];

const priceLabel = (cents: number | null): string | null =>
  cents === null ? null : `${(cents / 100).toFixed(2)} cr`;

/** An empty registry `defineFeatures` did not build — see the case that uses it. */
function emptyRegistry(): FeatureRegistry<Feature> {
  return {
    list: [],
    has: (feature: string): feature is Feature => feature.length < 0,
    def: (feature: Feature): ResolvedFeatureDef => {
      throw new Error(`Unknown feature: "${feature}"`);
    },
  };
}

/** A well-formed config, overridden per test with the thing being refused. */
function config(
  over: Partial<ApiEntitlementsConfig<Feature, PlanKey>> = {},
): ApiEntitlementsConfig<Feature, PlanKey> {
  return {
    features: FEATURES,
    plans: PLANS,
    source: createMemorySource<Feature>(),
    usage: { count: async () => 0 },
    defaultPlanKey: 'hobby',
    pricing: PRICING,
    formatPrice: priceLabel,
    messages: PT_BR_ENTITLEMENTS_MESSAGES,
    ...over,
  };
}

/** Build, and hand back whatever it threw. */
function buildWith(over: Partial<ApiEntitlementsConfig<Feature, PlanKey>>): unknown {
  try {
    createApiEntitlements(config(over));
    return null;
  } catch (error) {
    return error;
  }
}

describe('assertApiEntitlementsConfig', () => {
  it('builds a complete config without complaint', () => {
    expect(buildWith({})).toBeNull();
  });

  it('refuses an empty feature catalog — it opens every gate, it does not close one', () => {
    // The empty-collection trap in its purest form. With no declared features
    // every key resolves `not-supported`, and `withEntitlement` deliberately
    // renders a `not-supported` page UNLOCKED (a stale client must not paywall
    // a page the tenant owns). So "declare nothing" is not a lockout — it is
    // an app with every plan-gated page open.
    //
    // The registry is hand-rolled rather than `defineFeatures({})` because
    // that now throws in its own right (registry.ts). This assertion used to be
    // the only one anywhere, sitting a layer ABOVE the hazard and off the path
    // ADOPTING.md §4 walks adopters down; what is left for it to catch is the
    // registry this package did not build — `FeatureRegistry` is published, so
    // a host can implement it itself.
    const error = buildWith({ features: emptyRegistry() });
    expect(error).toBeInstanceOf(EntitlementsConfigError);
    expect(String(error)).toMatch(/`features` declares no feature keys/);
  });

  it('refuses an empty catalog at construction too, before any surface exists', () => {
    // The blocker this pair now closes from both ends: an adopter who never
    // calls `createApiEntitlements` is refused by `defineFeatures` itself.
    expect(() => defineFeatures({})).toThrow(/declares no feature keys/);
  });

  it('refuses an empty ladder, and asks for `null` when that is what was meant', () => {
    const error = buildWith({ plans: definePlans(FEATURES, {}) as never });
    expect(String(error)).toMatch(/`plans` is an empty catalog/);
    // …and the deliberate version builds.
    expect(buildWith({ plans: null, defaultPlanKey: 'hobby' })).toBeNull();
  });

  it('refuses a default plan key the ladder does not declare', () => {
    const error = buildWith({ defaultPlanKey: 'legacy' as PlanKey });
    expect(String(error)).toMatch(/`defaultPlanKey` is "legacy"/);
  });

  it('refuses a ladder with an unnamed tier — the raw key would face a customer', () => {
    // `TenantPlanView.name` falls back to the plan KEY when pricing has no row
    // for it, and "the raw key must never face a customer" is this surface's
    // own documented invariant. A missing row is a missing NAME, not a missing
    // price.
    const error = buildWith({ pricing: [PRICING[0]!] });
    expect(String(error)).toMatch(/names no tier for "network"/);
  });

  it('refuses duplicate and blank pricing rows', () => {
    expect(String(buildWith({ pricing: [...PRICING, PRICING[0]!] }))).toMatch(
      /Two `pricing` rows share the key "hobby"/,
    );
    expect(String(buildWith({ pricing: [{ key: 'hobby', name: '  ', priceCents: 0 }] }))).toMatch(
      /empty `name`/,
    );
  });

  it('refuses a declared quota with no way to count it', () => {
    // Without the port the ceiling reads `used = 0` forever, so `used + 1 >
    // limit` is false for every ceiling ≥ 1 and the quota is simply never
    // enforced — on exactly the tiers being sold.
    const error = buildWith({ usage: null });
    expect(String(error)).toMatch(/`usage` is not configured/);
  });

  it('refuses a `usage` that is present but cannot count', () => {
    // `usage == null` used to be the whole test, so an object that merely
    // EXISTED satisfied it and the failure moved to the first `checkQuota` —
    // i.e. back to a runtime failure on whichever tier sells that ceiling,
    // which is the thing the assembly check exists to bring forward.
    expect(String(buildWith({ usage: {} as never }))).toMatch(/no `count\(/);
    expect(String(buildWith({ usage: { count: 'soon' } as never }))).toMatch(/no `count\(/);
    // A registry is checked through its port, not its own shape.
    expect(String(buildWith({ usage: { port: {}, assertRegistered: () => {} } as never }))).toMatch(
      /no `count\(/,
    );
  });

  it('accepts a bare counter, and says out loud what that costs', () => {
    // A plain `UsageCounter` is legitimate config and builds. What it does NOT
    // buy is the per-quota audit: `assertRegistered` only runs when `usage` is
    // a registry, so `stations.online` having no counter behind this function
    // is not detectable here. That is a documented limit of the coarse check,
    // not a bug in it — the PR body used to claim more.
    expect(buildWith({ usage: { count: async () => 0 } })).toBeNull();
  });

  it('refuses a missing price formatter rather than picking a currency', () => {
    const error = buildWith({ formatPrice: undefined as never });
    expect(String(error)).toMatch(/`formatPrice` is required/);
  });

  it("refuses missing messages rather than answering in another product's words", () => {
    // The runtime half of the copy port, for a host on plain JS: the compiled
    // TS type already requires `messages`.
    const error = buildWith({ messages: undefined as never });
    expect(String(error)).toMatch(/`messages` is required/);
  });

  it('refuses a nonsensical cache TTL and a blank permission id', () => {
    expect(String(buildWith({ cacheTtlSeconds: 0 }))).toMatch(/`cacheTtlSeconds`/);
    expect(String(buildWith({ planRequestPermission: '   ' }))).toMatch(
      /`planRequestPermission` is empty/,
    );
  });

  it('gates the write on the id the host named, not on the package default', () => {
    const api = createApiEntitlements(
      config({ planRequestPermission: 'billing:negotiate', planChangeRequests: {
        getOpen: async () => null,
        create: async () => ({ request: { id: 'r1', status: 'open' }, created: true }),
      } }),
    );
    const post = api.routes.find((r) => r.method === 'POST' && r.path === '/plan/request');
    expect(post).toBeDefined();
    return Promise.all([
      post!
        .handle({ actor: { tenantId: 't1', permissions: ['plan:request'] }, body: {} })
        .then((r) => expect(r.status).toBe(403)),
      post!
        .handle({
          actor: { tenantId: 't1', permissions: ['billing:negotiate'] },
          body: { requestedPlan: 'network' },
        })
        .then((r) => expect(r.status).toBe(200)),
    ]);
  });
});
