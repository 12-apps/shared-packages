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
  assertApiEntitlementsConfig,
  createApiEntitlements,
  EntitlementsConfigError,
  type ApiEntitlements,
  type ApiEntitlementsConfig,
  type EntitlementsActor,
  type EntitlementsRequest,
  type EntitlementsRoute,
  type PlanChangeRequestPort,
  type UsageRegistryLike,
} from './create-api-entitlements';
export {
  definePermissionContribution,
  entitlementsPermissions,
  PLAN_REQUEST_PERMISSION,
  type EntitlementPermissionContribution,
  type EntitlementPermissionKind,
  type EntitlementPermissionLabels,
  type EntitlementPermissionOf,
  type EntitlementPermissionSpec,
  type EntitlementsPermission,
} from './contribution';
export type {
  EntitlementDenialMessages,
  EntitlementsCopyResolver,
  EntitlementsCopySource,
  EntitlementsMessages,
  PlanDiffMessages,
  PlanImpactMessages,
  PlanViewMessages,
} from './copy';
export { resolveEntitlementsCopy } from './copy';
export {
  PT_BR_ENTITLEMENTS_MESSAGES,
  PT_BR_ENTITLEMENTS_PERMISSION_LABELS,
} from './pt-BR';
export {
  EN_US_ENTITLEMENTS_MESSAGES,
  EN_US_ENTITLEMENTS_PERMISSION_LABELS,
} from './en-US';
export { ENTITLEMENTS_MESSAGES, ENTITLEMENTS_PERMISSION_LABELS } from './locales';
export {
  entitlementDenialResponse,
  isEntitlementDenial,
  type WireResponse,
} from './wire';
export {
  buildTenantPlanView,
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
  FiledPlanRequest,
  OpenPlanRequest,
  PlanChangeRequestBody,
  TenantFeatureReason,
  TenantPlanPayload,
} from '../plan-wire';

/**
 * The plan-change notice: the blueprint factory a host words itself, plus the
 * two ready packs. This package DECLARES the content and does not emit it —
 * the tier write is the platform writer's, host-side. See `./notifications`.
 */
export {
  createPlanChangedBlueprint,
  PLAN_CHANGED_NOTIFICATION_TYPE,
  type EntitlementsNotificationBlueprint,
  type EntitlementsNotificationContent,
  type PlanChangedCopy,
  type PlanChangedPayload,
  type PlanLabelLookup,
} from './notifications';
export { ptBrPlanChangedCopy } from './pt-BR';
export { enUsPlanChangedCopy } from './en-US';
