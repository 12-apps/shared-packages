/**
 * `@12-apps/entitlements/server` — the backend half of the surface.
 *
 * `createApiEntitlements(config)` is the single factory a host mounts; the
 * rest of this entry is the machinery a host wires INTO that config (usage
 * registry, quota guard, retention, settings writer, channel policy) plus the
 * pure plan analytics (view, diff, impact) that back the operator tooling.
 *
 * Framework-free: routes are neutral descriptors, adapted by
 * `@12-apps/entitlements/hono` (or forty lines of any other framework).
 */
export {
  createApiEntitlements,
  type ApiEntitlements,
  type ApiEntitlementsConfig,
  type EntitlementsActor,
  type EntitlementsRequest,
  type EntitlementsRoute,
  type PlanChangeRequestPort,
  type UsageRegistryLike,
} from './create-api-entitlements';
export {
  entitlementDenialResponse,
  isEntitlementDenial,
  PAYMENT_REQUIRED_MESSAGE,
  type WireResponse,
} from './wire';
export {
  buildTenantPlanView,
  formatPrice,
  type PricingRow,
  type QuotaUsageView,
  type TenantFeatureView,
  type TenantPlanView,
} from './plan-view';
export {
  collectFlags,
  describeLoss,
  diffDecisions,
  parseGatePolicy,
  summarizeDiff,
  type FeatureLoss,
  type TenantDiff,
} from './plan-diff';
export {
  createPlanImpact,
  type ImpactSummary,
  type ImpactSurface,
  type PlanImpact,
  type PlanImpactConfig,
  type SummarizableTenant,
  type Violation,
} from './plan-impact';
export {
  createUsageRegistry,
  monthWindowStart,
  type UsageCounterFn,
  type UsageRegistry,
  type UsageRegistryConfig,
} from './usage-registry';
export {
  createWithinQuota,
  isSerializationFailure,
  QuotaRaceError,
  QuotaRecountError,
  type SerializableTransactor,
} from './quota-guard';
export {
  createRetention,
  type Retention,
  type RetentionConfig,
  type RetentionWatermarkDb,
  type RetentionWatermarkRow,
} from './retention';
export {
  createFeatureSettings,
  type FeatureSettings,
  type FeatureSettingsConfig,
  type FeatureSettingsStore,
  type FeatureSettingState,
} from './settings';
export { createChannelEntitlementFilter } from './channel-policy';
export type {
  ComparisonLine,
  ComparisonSection,
  ComparisonTier,
  OpenPlanRequest,
  PlanChangeRequestBody,
  TenantFeatureReason,
  TenantPlanPayload,
} from '../plan-wire';
