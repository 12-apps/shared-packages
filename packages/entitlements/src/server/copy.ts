/**
 * Every sentence the server half emits — REQUIRED host config, with NO
 * defaults (the copy-portability doctrine). This surface answered its 401,
 * its refusals, its denial bodies, the plan screen's situation notes and the
 * operator reports in one product's Portuguese, compiled in where no host
 * could reach it and nothing failed. A pt-BR host imports
 * {@link PT_BR_ENTITLEMENTS_MESSAGES} from `./pt-BR` (re-exported at
 * `@12-apps/entitlements/server` and `/hono`) and passes it by hand — one
 * reviewable line, never a silence.
 *
 * The split this port enforces: wire CODES stay the package's own — statuses,
 * the `code` discriminators (`entitlement_required`, `quota_exceeded`), the
 * `reason` values the SPA branches on — because both halves of the contract
 * parse them. Only the SENTENCES beside them move. `TenantFeatureView` keeps
 * `note` (a sentence, from here) next to `reason` (a code, the package's)
 * for exactly that reason.
 *
 * Facts travel as ARGUMENTS (a limit, a usage count, a plan label), so a
 * translation can put them where its own grammar wants them — and so a host
 * that raises a ceiling cannot end up with copy naming the old number.
 */
import type { TenantFeatureReason } from '../plan-wire';
import type { FeatureLoss } from './plan-diff';

export interface EntitlementsMessages {
  /** The 401 body when the adapter's `resolveActor` answers null. */
  unauthenticated: string;
  /** The 403 body when the actor lacks the plan-request permission. */
  planRequestForbidden: string;
  /** The 400 body when the ask fails validation. */
  invalidPlanRequest: string;
  /** The 402 body's sentence — the machine half (`code`, …) rides beside it. */
  paymentRequired: string;
  /** The 409 body for `disabled-by-tenant`: their own switch, never a sale. */
  featureDisabledByTenant: string;
  /** The 404 body for `not-supported`: not for sale, not fixable, not named. */
  featureUnavailable: string;
  /**
   * The plan screen's situation note per visible reason. Keyed by the WIRE
   * code (which stays the package's); the sentence beside it is the host's.
   * `not-supported` has no key because those rows are dropped entirely.
   */
  featureNotes: Record<TenantFeatureReason, string>;
  /**
   * The note for a quota the tenant has OUTGROWN — entitled, holding more
   * than the ceiling. Everything they have keeps working; only adding more
   * needs a bigger plan. `nextPlanLabel` is the COMMERCIAL name of the tier
   * whose ceiling clears what they hold, or null when no tier would — and a
   * null must drop the upsell clause, because a wrong upsell is the single
   * most damaging thing the plan screen could print.
   */
  overQuotaNote: (context: {
    limit: number;
    used: number;
    nextPlanLabel: string | null;
  }) => string;
  /**
   * The 409 body when `createWithinQuota` loses a serialization race — the
   * honest answer is "try again". Wired per call site
   * (`raceMessage: messages.quotaRaceRetry`), because the guard runs inside
   * host route handlers rather than behind this package's mount.
   */
  quotaRaceRetry: string;
  /**
   * One loss line in the fleet-diff artifact (`describeLoss`) — the whole
   * sentence, from the loss: what goes, whether their data goes with it, and
   * the tier that gives it back when one would. An operator reads this to
   * sign off a rollout, so it is copy, not a log line.
   */
  lossLine: (loss: FeatureLoss) => string;
  /**
   * The impact report's caveat for tenants scored against the default tier
   * because their assigned key is outside the ladder.
   */
  offLadderNote: (context: {
    offLadder: number;
    total: number;
    defaultPlanKey: string;
  }) => string;
  /** The report's line for tenants the catalog cannot score at all. */
  unscorableNote: (context: { unscorable: number; total: number }) => string;
  /**
   * The tier-breakdown flag for tenants no tier fits — spelled against the
   * ladder's own top tier. Its unflagged siblings (`<tier> <count>`) carry no
   * language and stay the package's; these two carry the flag's wording and
   * travel together so a host rewording one cannot strand the other's style.
   */
  tierBreakdownAboveTop: (context: { topTier: string; count: number }) => string;
  /** The flag for a count sitting on a tier the ladder no longer declares. */
  tierBreakdownOffLadder: (context: { tier: string; count: number }) => string;
}

/** What `entitlementDenialResponse` needs — the pack satisfies it. */
export type EntitlementDenialMessages = Pick<
  EntitlementsMessages,
  'paymentRequired' | 'featureDisabledByTenant' | 'featureUnavailable'
>;

/** What `buildTenantPlanView` needs — the pack satisfies it. */
export type PlanViewMessages = Pick<EntitlementsMessages, 'featureNotes' | 'overQuotaNote'>;

/** What `describeLoss` needs — the pack satisfies it. */
export type PlanDiffMessages = Pick<EntitlementsMessages, 'lossLine'>;

/** What `createPlanImpact` needs — the pack satisfies it. */
export type PlanImpactMessages = Pick<
  EntitlementsMessages,
  'offLadderNote' | 'unscorableNote' | 'tierBreakdownAboveTop' | 'tierBreakdownOffLadder'
>;
