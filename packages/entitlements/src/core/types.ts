/**
 * Shared contracts for the entitlements library.
 *
 * The core answers exactly one question — *what is this tenant's plan allowed
 * to use?* — and is storage-, framework- and **billing**-agnostic. It never
 * learns what a price, an invoice or a payment provider is: it accepts an
 * already-resolved entitlement map plus a coarse lifecycle status. Billing is
 * one possible writer of the plan layer, never a dependency. That rule is what
 * lets a host with hand-assigned tiers, an internal beta programme, or no
 * billing at all use this package unchanged.
 *
 * Zero runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * What a plan grants for one feature.
 *
 * - `boolean` — a plain on/off capability.
 * - `number`  — a quota (max stock locations, max members, MCP calls/month).
 *               `0` is a real value meaning "entitled to none", i.e. OFF.
 * - `'unlimited'` — an uncapped quota. Kept as a sentinel rather than
 *               `Infinity` so a map survives `JSON.stringify` on the wire.
 */
export type EntitlementValue = boolean | number | 'unlimited';

/** A partial map of feature -> granted value. A missing key is NOT entitled. */
export type EntitlementMap<F extends string> = Partial<
  Record<F, EntitlementValue>
>;

/**
 * The tenant's own switches, applied to what the plan already grants.
 *
 * This layer can only ever NARROW the plan — it cannot entitle something the
 * plan withholds, because layer 2 has already denied by the time it is read.
 * Within the entitled set, though, it moves in both directions: a feature
 * declared `defaultWhenEntitled: false` (approvals, say) stays off until the
 * tenant sets `true` here. A missing key means "use the feature's default".
 */
export type SettingsMap<F extends string> = Partial<Record<F, boolean>>;

/**
 * Coarse lifecycle state of the tenant's commercial relationship.
 *
 * Deliberately generic — NOT `past_due`. A billing system maps its own states
 * into these three, so the core never learns what a missed payment is:
 *
 * - `active`     — everything the plan grants applies.
 * - `restricted` — a soft penalty (dunning, expired trial). Only features
 *                  declared `retainWhenRestricted` survive.
 * - `suspended`  — a hard stop. Nothing is entitled, no exceptions.
 */
export type LifecycleStatus = 'active' | 'restricted' | 'suspended';

// ---------------------------------------------------------------------------
// Feature catalog
// ---------------------------------------------------------------------------

/**
 * What the host must do to already-existing data when an entitlement is lost.
 * The core DECLARES the policy and surfaces it on every decision; enforcing it
 * is the host's job, because only the host knows its own tables.
 *
 * **Downgrade must never delete data.**
 *
 * - `hide`     — the surface disappears; rows are untouched (e.g. audit log).
 * - `readonly` — existing rows stay visible and usable, `create`/`update`
 *                refuse (e.g. stock locations).
 * - `disable`  — existing rows are deactivated but retained, and reactivate on
 *                re-entitlement (e.g. MCP connections).
 */
export type RevokePolicy = 'hide' | 'readonly' | 'disable';

/** How a feature is measured. */
export type FeatureKind = 'boolean' | 'quota';

/** One entry in the host's feature catalog. */
export interface FeatureDef {
  /**
   * `'boolean'` (default) for on/off capabilities; `'quota'` for numeric
   * limits. A quota feature's plan value must be a number or `'unlimited'`.
   */
  kind?: FeatureKind;
  /** What the host must do to existing data on revoke. Defaults to `'hide'`. */
  onRevoke?: RevokePolicy;
  /**
   * Whether an entitled tenant gets this feature by default when they have
   * never touched the tenant-layer switch. Defaults to `true` — an entitled
   * tenant is never forced, but they do not have to opt in either. Set `false`
   * for features that gate writes (approvals) so a tenant opts in deliberately.
   */
  defaultWhenEntitled?: boolean;
  /**
   * Whether this feature survives a `restricted` lifecycle status. Defaults to
   * `false`. Set `true` for the read-only escape hatches a delinquent tenant
   * must keep (e.g. reading their own orders) so dunning degrades rather than
   * bricks the account.
   */
  retainWhenRestricted?: boolean;
  /** Human-readable label for admin/backoffice surfaces. */
  description?: string;
}

/** A resolved catalog entry — every optional field defaulted. */
export interface ResolvedFeatureDef {
  kind: FeatureKind;
  onRevoke: RevokePolicy;
  defaultWhenEntitled: boolean;
  retainWhenRestricted: boolean;
  description: string | null;
}

/**
 * The feature registry: the typed union of feature keys plus their metadata.
 * Built by {@link defineFeatures}; mirrors `@12-apps/rbac`'s `definePermissions`.
 */
export interface FeatureRegistry<F extends string> {
  /** Every declared feature key, in declaration order. */
  readonly list: readonly F[];
  /** Type guard — is this string a declared feature? */
  has(feature: string): feature is F;
  /** Metadata for a declared feature. Throws on an unknown key. */
  def(feature: F): ResolvedFeatureDef;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * A plan as the host authors it. `extends` composes another plan by key so
 * tiers stack (`pro extends plus extends basic`) without repeating entries;
 * the resolved map is flat, so runtime resolution never walks a chain.
 *
 * NOTE the absence of price, currency and interval. Those belong to the host's
 * billing system, not here.
 */
export interface PlanDef<F extends string, K extends string = string> {
  /** Key of the plan this one builds on. Own entries win over inherited. */
  extends?: K;
  /** What this tier grants (merged over the inherited map). */
  entitlements: EntitlementMap<F>;
  /** Human-readable label for admin/backoffice surfaces. */
  description?: string;
}

/** A plan after `extends` chains are flattened. */
export interface ResolvedPlan<F extends string> {
  key: string;
  /** Flat, fully-inherited entitlement map. */
  entitlements: EntitlementMap<F>;
  description: string | null;
  /** 0-based declaration order — drives "cheapest plan with feature X". */
  rank: number;
}

/** The compiled plan catalog. */
export interface PlanCatalog<F extends string, K extends string = string> {
  /** Every plan key, in declaration order (assumed cheapest -> richest). */
  readonly list: readonly K[];
  /** Flattened plan by key. Throws on an unknown key. */
  get(key: K): ResolvedPlan<F>;
  /**
   * The lowest-ranked plan whose resolved map grants `feature` with a ceiling
   * STRICTLY GREATER than `minLimit`, or `null` if no plan does. This is what
   * populates the 402's `requiredPlan`, and hence the upsell CTA.
   *
   * `minLimit` defaults to 0, i.e. "any plan that grants this at all". Pass
   * the tenant's current ceiling when upselling a spent quota, so a tenant on
   * 10 seats is offered the plan with 25 rather than the one they already
   * have.
   */
  cheapestWith(feature: F, minLimit?: number): ResolvedPlan<F> | null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** Why a feature resolved the way it did. */
export type EntitlementReason =
  /** Granted. */
  | 'enabled'
  /** Not declared in this build's catalog — the host cannot serve it at all. */
  | 'not-supported'
  /** The tenant's plan (and overrides) do not grant it. → upsell. */
  | 'not-entitled'
  /** Entitled, but the tenant switched it off themselves. → not an upsell. */
  | 'disabled-by-tenant'
  /** Entitled, but withheld while the account is `restricted` (dunning). */
  | 'restricted'
  /** Entitled, but the account is `suspended`. */
  | 'suspended';

/** The resolved state of one feature for one tenant. */
export interface EntitlementDecision<F extends string> {
  feature: F;
  enabled: boolean;
  reason: EntitlementReason;
  /** What to do with existing data while this is off. */
  policy: RevokePolicy;
  /** Quota ceiling: a number, `'unlimited'`, or `null` for boolean features. */
  limit: number | 'unlimited' | null;
  /**
   * The cheapest plan that would grant this, or `null` when no plan does or
   * the denial is not a plan problem (a tenant-disabled feature is not an
   * upsell — offering one would be a lie).
   */
  requiredPlan: string | null;
}

/** An {@link EntitlementDecision} enriched with live usage for a quota feature. */
export interface QuotaDecision<F extends string> extends EntitlementDecision<F> {
  /** Current usage, from the host's {@link UsageCounter}. */
  used: number;
  /** `limit - used`, floored at 0; `Infinity` when unlimited. */
  remaining: number;
  /** True when `used >= limit`. Existing rows survive; `create` must refuse. */
  exceeded: boolean;
}

// ---------------------------------------------------------------------------
// Wire snapshot
// ---------------------------------------------------------------------------

/**
 * The JSON-serializable projection handed to a browser. The client NEVER
 * re-resolves entitlements — it receives this and renders. Safe to ship: a
 * plan catalog is public marketing information.
 */
export interface EntitlementSnapshot<F extends string> {
  tenantId: string;
  status: LifecycleStatus;
  /** The tenant's current plan key, if the host tracks one. */
  planKey: string | null;
  features: Record<F, EntitlementDecision<F>>;
}

// ---------------------------------------------------------------------------
// Ports — the entire host seam
// ---------------------------------------------------------------------------

/** What the host's storage must hand back for a tenant. */
export interface TenantEntitlementState<F extends string> {
  /** From a plan row, a contract, a config file — the core does not care. */
  plan: EntitlementMap<F>;
  /** The plan's key, purely for reporting. */
  planKey?: string | null;
  /** Comped / beta / enterprise grants, layered OVER the plan. */
  overrides?: EntitlementMap<F>;
  /**
   * The tenant's own switches over what the plan grants. Cannot entitle
   * anything the plan withholds; can toggle either way within the entitled
   * set (see {@link SettingsMap}).
   */
  settings?: SettingsMap<F>;
  /** Defaults to `'active'` when the host does not track lifecycle. */
  status?: LifecycleStatus;
}

/**
 * Port: where a tenant's entitlement state comes from. The host implements it
 * against its own database; the core never issues a query.
 */
export interface EntitlementSource<F extends string> {
  load(tenantId: string): Promise<TenantEntitlementState<F>>;
}

/**
 * Port: current usage for numeric quotas.
 *
 * ⚠️ This MUST stay a port. The moment the library writes a `count()` query it
 * is married to one schema and stops being portable.
 *
 * ⚠️ Check-then-act is NOT atomic. Two concurrent creates can both read
 * `used = 9` against a limit of 10 and both pass. The core returns a
 * *decision*; the host enforces atomically — count inside the insert's
 * transaction, or use a DB constraint. Decide per feature whether soft overage
 * is acceptable (usually yes for metered calls, never for seats).
 */
export interface UsageCounter<F extends string> {
  count(tenantId: string, feature: F): Promise<number>;
}

/**
 * Port: an optional read-through cache. String-valued so Redis drops straight
 * in. The host must invalidate on any plan / override / settings / status
 * write — {@link EntitlementsEngine.invalidate} is the hook.
 */
export interface EntitlementCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}
