/**
 * `@12-apps/entitlements/react` — client bindings.
 *
 * Types and pure helpers only; no ports, no adapters, no engine. See the
 * boundary test in `src/react/__tests__/boundary.test.ts`.
 */
export {
  EntitlementsProvider,
  Entitled,
  Locked,
  useEntitlement,
  useEntitlementSnapshot,
  useIsEntitled,
  useQuota,
  useUpsell,
  type EntitledProps,
  type EntitlementsProviderProps,
  type LockedProps,
  type QuotaView,
  type UpsellRequest,
} from './context';

export type {
  EntitlementDecision,
  EntitlementReason,
  EntitlementSnapshot,
  LifecycleStatus,
  RevokePolicy,
} from '../core/types';

export {
  createWebEntitlements,
  type WebEntitlements,
} from './create-web-entitlements';
export { withEntitlement } from './with-entitlement';
export {
  raiseUpsell,
  subscribeToUpsell,
  upsellPromptFromPaymentRequired,
  type UpsellPrompt,
  type UpsellReason,
} from './upsell-channel';
export type {
  EntitlementsLinkProps,
  TenantSwitchLocation,
  WebEntitlementsConfig,
} from './web-config';
export type {
  ComparisonLine,
  ComparisonSection,
  ComparisonTier,
  OpenPlanRequest,
  TenantFeatureReason,
  TenantFeatureView,
  TenantPlanPayload,
  TenantPlanView,
} from '../plan-wire';
