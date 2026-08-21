/**
 * The backend surface's CONFIG, and the wiring check that runs ONCE when the
 * host builds it.
 *
 * Every rule here used to be a DEFAULT, an optional field, or nothing at all —
 * a question this package answered on behalf of a host that had not answered
 * it. That is the failure this module exists to make impossible: a host which
 * says nothing about what its tiers are called or what its money reads like
 * must be told so at the call site, rather than quietly inherit the
 * application this package was extracted from. The screen would still render;
 * it would render another product's prices.
 *
 * It throws at ASSEMBLY rather than per request, because a misconfiguration
 * that only shows up on the one endpoint nobody exercised is a
 * misconfiguration that ships. And it refuses EMPTY collections rather than
 * reading them as a deliberate lockout: an empty feature registry does not
 * lock everything down, it makes every gate resolve `not-supported`, which
 * `withEntitlement` renders UNLOCKED.
 */
import type {
  EntitlementCache,
  EntitlementSource,
  FeatureRegistry,
  PlanCatalog,
  UsageCounter,
} from '../core/types';
import type { ComparisonTier } from '../plan-wire';
import type { EntitlementsMessages } from './copy';
import type { PricingRow } from './plan-view';
import type { PlanChangeRequestPort } from './routes';

/** A usage registry (usage-registry.ts) — the port plus its boot-time audit. */
export interface UsageRegistryLike<F extends string> {
  port: UsageCounter<F>;
  assertRegistered(quotaFeatures: readonly string[]): void;
}

/**
 * Everything the backend surface needs.
 *
 * `K` carries the PLAN-KEY literal union and has no default: with
 * `K extends string = string` the ladder's keys collapse to `string` the
 * moment the config is annotated, and `defaultPlanKey` stops being checkable
 * against the tiers that actually exist. It is inferred from `plans`; a host
 * with no ladder passes `plans: null` and gets `string`.
 */
export interface ApiEntitlementsConfig<F extends string, K extends string> {
  features: FeatureRegistry<F>;
  /**
   * The tier ladder — config/data, authored by the host. `null`, explicitly,
   * for hand-assigned entitlement maps: an ABSENT field would let a host that
   * simply forgot its ladder ship a surface where nothing is ever an upsell.
   */
  plans: PlanCatalog<F, K> | null;
  /** Where the tenant's entitlement state lives (a HOST table, behind a port). */
  source: EntitlementSource<F>;
  /**
   * Usage counters for quota features. Pass the registry from
   * `createUsageRegistry` to also get its boot-time audit: an engine whose
   * catalog declares a quota this host cannot count refuses to build at all.
   *
   * Required as soon as the catalog declares one quota feature — see
   * {@link assertApiEntitlementsConfig}.
   */
  usage?: UsageCounter<F> | UsageRegistryLike<F> | null;
  cache?: EntitlementCache | null;
  cacheTtlSeconds?: number;
  /** The tier a tenant with no recognisable plan key resolves to. */
  defaultPlanKey: K;
  /**
   * Pricing DISPLAY rows from the host's billing (never computed here).
   *
   * Required, and required to NAME every tier, because `TenantPlanView` falls
   * back to the raw plan key when a tier has no row — and "the raw key must
   * never face a customer" is this surface's own documented invariant.
   */
  pricing: readonly PricingRow[];
  /** The pricing cards, assembled by the host's billing catalog. */
  comparison?: (currentPlanKey: string) => ComparisonTier[];
  /**
   * How a price in cents reads on the wire (`TenantPlanView.price`).
   *
   * REQUIRED. This package words money it is handed and must not dictate whose
   * money it is: the removed default spelled one particular currency, symbol
   * and decimal comma included, so every silent host billed in another one
   * rendered its prices in somebody else's money.
   */
  formatPrice: (priceCents: number | null) => string | null;
  /** The plan-change lead store. Omit it and the request routes do not exist. */
  planChangeRequests?: PlanChangeRequestPort | null;
  /**
   * The permission id that may file a plan-change request. Defaults to this
   * package's OWN id (`PLAN_REQUEST_PERMISSION`) — see contribution.ts for why
   * that is a default rather than an assumption about the host.
   */
  planRequestPermission?: string;
  /**
   * Every sentence this surface answers with — REQUIRED, the host's words,
   * exactly like `formatPrice` is the host's money: the refusals, the denial
   * bodies, the plan screen's situation notes, and the adapter's 401. pt-BR
   * hosts pass `PT_BR_ENTITLEMENTS_MESSAGES` from `./pt-BR`.
   */
  messages: EntitlementsMessages;
}

/** A wiring mistake in the HOST's configuration of this surface. */
export class EntitlementsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntitlementsConfigError';
    Object.setPrototypeOf(this, EntitlementsConfigError.prototype);
  }
}

function failConfig(message: string): never {
  throw new EntitlementsConfigError(message);
}

/** `''`, `'   '` and a non-string all read as "not answered". */
function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** An object field that was not answered at all (plain-JS hosts included). */
function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * The catalog must declare something.
 *
 * An empty registry is the archetypal fail-OPEN empty collection: every gate
 * resolves `not-supported`, the browser snapshot is `{}`, and `withEntitlement`
 * deliberately renders a `not-supported` page UNLOCKED (a stale client must
 * never paywall a page the tenant owns). So "no features" does not lock the app
 * down — it opens every plan-gated page in it.
 */
function assertFeatures<F extends string>(features: FeatureRegistry<F>): void {
  if (features.list.length === 0) {
    failConfig(
      '`features` declares no feature keys. An empty catalog does not gate ' +
        'anything: every key resolves `not-supported`, which the page gate renders ' +
        'UNLOCKED. Declare the catalog with defineFeatures().',
    );
  }
}

/** The ladder, and the tier a tenant falls back to when nothing recognises theirs. */
function assertLadder<F extends string, K extends string>(
  config: ApiEntitlementsConfig<F, K>,
): void {
  if (config.plans !== null && config.plans.list.length === 0) {
    failConfig(
      '`plans` is an empty catalog. Pass `plans: null` for hand-assigned ' +
        'entitlements — an empty ladder silently makes every denial unsellable ' +
        '(`requiredPlan` is null for everything) while claiming to have tiers.',
    );
  }
  if (isBlank(config.defaultPlanKey)) {
    failConfig('`defaultPlanKey` is empty. Name the tier an unrecognised plan key falls back to.');
  }
  if (config.plans !== null) {
    const keys = config.plans.list as readonly string[];
    if (!keys.includes(config.defaultPlanKey)) {
      failConfig(
        `\`defaultPlanKey\` is "${config.defaultPlanKey}", which the ladder does not ` +
          `declare (${keys.join(', ')}). Every tenant with an unrecognised key resolves ` +
          'to it, so a key outside the ladder leaves them on a tier nothing can score.',
      );
    }
  }
}

/**
 * Pricing names the tiers.
 *
 * A missing row is not a missing price — it is a missing NAME, and the view
 * falls back to the raw plan key, which is the one thing this surface promises
 * never to show a customer.
 */
function assertPricing<F extends string, K extends string>(
  config: ApiEntitlementsConfig<F, K>,
): void {
  const rows = config.pricing;
  if (!Array.isArray(rows)) failConfig('`pricing` is missing. Pass the host billing display rows.');

  const seen = new Set<string>();
  for (const row of rows) {
    if (isBlank(row.key)) failConfig('A `pricing` row has an empty `key`.');
    if (isBlank(row.name)) failConfig(`Pricing row "${row.key}" has an empty \`name\`.`);
    if (seen.has(row.key)) failConfig(`Two \`pricing\` rows share the key "${row.key}".`);
    seen.add(row.key);
    if (!Number.isFinite(row.priceCents)) {
      failConfig(`Pricing row "${row.key}" has a non-numeric \`priceCents\`.`);
    }
  }

  const needed =
    config.plans === null
      ? [config.defaultPlanKey as string]
      : [...(config.plans.list as readonly string[])];
  const unnamed = needed.filter((key) => !seen.has(key));
  if (unnamed.length > 0) {
    failConfig(
      `\`pricing\` names no tier for ${unnamed.map((key) => `"${key}"`).join(', ')}. ` +
        'Every tier needs a commercial name — without one the plan screen shows the ' +
        'raw key, which is the one thing it promises a customer never sees.',
    );
  }
}

/**
 * A declared quota with nowhere to count from.
 *
 * Without the port the engine throws on the first `checkQuota` — a runtime
 * failure on whichever tier happens to sell that ceiling, rather than at boot.
 *
 * ⚠️ **This is the COARSE check, and it is the only one a bare `UsageCounter`
 * gets.** The per-quota audit — "the catalog declares a ceiling this host
 * cannot count" — lives on `UsageRegistryLike.assertRegistered`, and
 * `createApiEntitlements` can only run it when `usage` actually IS a registry
 * (`'port' in usage`). Hand in a plain counter, or a registry's own `.port`,
 * and nothing checks that every declared quota has a counter behind it: a
 * counter that answers `0` for a key it does not know leaves `used + 1 > limit`
 * false for every ceiling ≥ 1, which is the silently-unlimited tier this whole
 * area exists to prevent. Pass `createUsageRegistry(...)` itself, not its port.
 */
function assertUsage<F extends string, K extends string>(
  config: ApiEntitlementsConfig<F, K>,
): void {
  const quotas = config.features.list.filter(
    (feature) => config.features.def(feature).kind === 'quota',
  );
  const usage = config.usage ?? null;
  if (quotas.length === 0) return;
  if (usage === null) {
    failConfig(
      `The catalog declares quota feature(s) ${quotas.map((key) => `"${key}"`).join(', ')} ` +
        'but `usage` is not configured. Pass createUsageRegistry(...) so the ceilings ' +
        'can be measured — an unmeasurable ceiling is never enforced.',
    );
  }
  // Shape, not coverage. `usage == null` was the entire test, so an object
  // that is merely present passed — and a `usage` with no callable `count`
  // fails on the first `checkQuota` instead of at boot, which is the exact
  // "runtime failure on whichever tier sells that ceiling" this check exists
  // to move forward. A registry is checked through its `port`.
  const port = 'port' in usage ? usage.port : usage;
  if (typeof port?.count !== 'function') {
    failConfig(
      '`usage` has no `count(tenantId, feature)` function. Pass a UsageCounter, or the ' +
        'registry from createUsageRegistry(...) — a `usage` that cannot count leaves ' +
        'every declared ceiling unenforced until the first checkQuota throws.',
    );
  }
}

/** Check a host's wiring, or throw naming the field that is wrong. */
export function assertApiEntitlementsConfig<F extends string, K extends string>(
  config: ApiEntitlementsConfig<F, K>,
): void {
  assertFeatures(config.features);
  assertLadder(config);
  assertPricing(config);
  assertUsage(config);

  if (typeof config.formatPrice !== 'function') {
    failConfig(
      '`formatPrice` is required. This package words a price it is handed but must ' +
        'not decide whose money it is — the removed default spelled Brazilian Reais.',
    );
  }
  if (isMissing(config.messages)) {
    failConfig(
      '`messages` is required. Every sentence this surface answers with is the ' +
        "host's — the removed defaults spelled one product's Portuguese. Pass " +
        'PT_BR_ENTITLEMENTS_MESSAGES for the original copy, or your own.',
    );
  }
  if (config.comparison !== undefined && typeof config.comparison !== 'function') {
    failConfig('`comparison` must be a function, or omitted for no pricing cards.');
  }
  if (
    config.cacheTtlSeconds !== undefined &&
    (!Number.isFinite(config.cacheTtlSeconds) || config.cacheTtlSeconds <= 0)
  ) {
    failConfig('`cacheTtlSeconds` must be a positive number of seconds.');
  }
  if (config.planRequestPermission !== undefined && isBlank(config.planRequestPermission)) {
    failConfig('`planRequestPermission` is empty. Name the permission, or omit the field.');
  }
}
