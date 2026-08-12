/**
 * `@12-apps/entitlements` — a portable, system-agnostic plan/feature gating layer.
 *
 * The third axis of access control, orthogonal to the other two:
 *
 *   | layer                 | question                          | denial |
 *   |-----------------------|-----------------------------------|--------|
 *   | code                  | does the build support it?        | 404    |
 *   | **entitlement**       | **does the tenant's plan cover it?** | **402** |
 *   | tenant setting        | did the tenant switch it off?     | hidden |
 *   | RBAC permission       | may THIS USER do it?              | 403    |
 *
 * Check entitlement BEFORE permission, and check them SEQUENTIALLY — never
 * intersect the two sets. Intersecting collapses "your plan doesn't include
 * this" into "you lack the permission" and destroys the upsell, which is the
 * commercial point of the layer.
 *
 * The package knows nothing about money. Billing is one possible writer of the
 * plan layer, never a dependency.
 *
 * Zero runtime dependencies. Framework-free. React bindings live in
 * `@12-apps/entitlements/react`.
 */

export { defineFeatures } from './core/registry';
export { definePlans } from './core/plans';
export { resolveEntitlement, resolveAll } from './core/resolve';
export { vetoByStatus, type StatusVeto } from './core/status';
export {
  toLimit,
  toWireLimit,
  isGranted,
  isExceeded,
  remainingOf,
} from './core/quota';
export {
  createEntitlements,
  type EntitlementsConfig,
  type EntitlementsEngine,
} from './core/engine';
export {
  EntitlementRequiredError,
  QuotaExceededError,
} from './core/errors';

export type {
  EntitlementCache,
  EntitlementDecision,
  EntitlementMap,
  EntitlementReason,
  EntitlementSnapshot,
  EntitlementSource,
  EntitlementValue,
  FeatureDef,
  FeatureKind,
  FeatureRegistry,
  LifecycleStatus,
  PlanCatalog,
  PlanDef,
  QuotaDecision,
  ResolvedFeatureDef,
  ResolvedPlan,
  RevokePolicy,
  SettingsMap,
  TenantEntitlementState,
  UsageCounter,
} from './core/types';

export {
  asRecord,
  toEntitlementMap,
  toSettingsMap,
  type JsonColumn,
} from './coerce';

export {
  createMemoryCache,
  createMemorySource,
  createMemoryUsage,
  type MemoryCache,
  type MemorySource,
  type MemoryUsage,
} from './memory';
