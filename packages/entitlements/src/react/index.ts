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
export { createWithEntitlement, type EntitlementGate } from './with-entitlement';
/**
 * The comparison band, and the derivation the cards are built on.
 *
 * Published because a host commonly renders the SAME catalog somewhere the
 * plan screen cannot reach — a public pricing page, where there is no tenant,
 * no session and therefore no `PlanScreen`. Without these, that page
 * re-implements the delta arithmetic and the matrix by hand, which is exactly
 * how the two drift into disagreeing about what a tier includes.
 */
export { ComparisonTable } from './comparison-table';
export { tierHighlights, type TierHighlights } from './tier-highlights';
export type {
  ComparisonTableCopy,
  EntitlementsWebCopy,
  PageLockCopy,
  PlanPageCopy,
  ReasonCopy,
  TierCardsCopy,
  UpsellHostCopy,
} from './copy';
export { PT_BR_ENTITLEMENTS_WEB_COPY } from './pt-BR';
export { EN_US_ENTITLEMENTS_WEB_COPY } from './en-US';
export { ENTITLEMENTS_WEB_COPY } from './locales';
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
  FiledPlanRequest,
  OpenPlanRequest,
  TenantFeatureReason,
  TenantFeatureView,
  TenantPlanPayload,
  TenantPlanView,
} from '../plan-wire';
