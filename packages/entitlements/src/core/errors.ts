import type { EntitlementDecision, QuotaDecision } from './types';

/**
 * Thrown by `require()` for ANY unusable feature — not only a plan gap.
 *
 * It is deliberately a DIFFERENT error from `@12-apps/rbac`'s
 * `PermissionDeniedError`: collapsing the two loses the distinction between
 * "your plan doesn't include this" and "ask your admin", which is the entire
 * commercial point of having an entitlement layer.
 *
 * ⚠️ **Do not map every instance to 402.** Branch on `decision.reason` — the
 * resolver preserves it precisely so the host can tell these apart, and
 * answering "Payment Required" to a tenant who switched a feature off
 * themselves is both wrong and slightly insulting:
 *
 * | `reason`             | meaning                        | suggested status |
 * |----------------------|--------------------------------|------------------|
 * | `not-entitled`       | plan gap → upsell              | **402**          |
 * | `restricted`         | dunning; they already paid     | **402**, no upsell |
 * | `suspended`          | hard stop; settle up           | **402**, no upsell |
 * | `disabled-by-tenant` | THEY turned it off             | 404 / 409 — not a payment problem |
 * | `not-supported`      | this build has no such feature | 404              |
 *
 * `requiredPlan` is non-null only for a genuine plan gap, so it is also the
 * cheap test for "is an upgrade CTA honest here?".
 */
export class EntitlementRequiredError<
  F extends string = string,
> extends Error {
  readonly tenantId: string;
  readonly feature: F;
  readonly decision: EntitlementDecision<F>;
  /** The cheapest plan that would grant it, when the denial is a plan problem. */
  readonly requiredPlan: string | null;

  constructor(tenantId: string, decision: EntitlementDecision<F>) {
    super(
      `Entitlement required: tenant "${tenantId}" cannot use "${decision.feature}" (${decision.reason})`,
    );
    this.name = 'EntitlementRequiredError';
    this.tenantId = tenantId;
    this.feature = decision.feature;
    this.decision = decision;
    this.requiredPlan = decision.requiredPlan;
    Object.setPrototypeOf(this, EntitlementRequiredError.prototype);
  }

  /** The JSON body a host should return with the 402. */
  toPayload(): {
    error: 'entitlement_required';
    feature: F;
    reason: string;
    requiredPlan: string | null;
  } {
    return {
      error: 'entitlement_required',
      feature: this.feature,
      reason: this.decision.reason,
      requiredPlan: this.requiredPlan,
    };
  }
}

/**
 * Thrown when the feature is entitled but the tenant has spent its quota.
 *
 * Also a 402 — the fix is a bigger plan — but distinct so a host can tell
 * "you can't do this at all" from "you've used all 10 of yours". Existing rows
 * are never at risk: this only ever refuses a NEW one.
 */
export class QuotaExceededError<F extends string = string> extends Error {
  readonly tenantId: string;
  readonly feature: F;
  readonly decision: QuotaDecision<F>;
  readonly requiredPlan: string | null;

  constructor(tenantId: string, decision: QuotaDecision<F>) {
    super(
      `Quota exceeded: tenant "${tenantId}" used ${decision.used} of ${String(decision.limit)} for "${decision.feature}"`,
    );
    this.name = 'QuotaExceededError';
    this.tenantId = tenantId;
    this.feature = decision.feature;
    this.decision = decision;
    this.requiredPlan = decision.requiredPlan;
    Object.setPrototypeOf(this, QuotaExceededError.prototype);
  }

  toPayload(): {
    error: 'quota_exceeded';
    feature: F;
    used: number;
    limit: number | 'unlimited' | null;
    requiredPlan: string | null;
  } {
    return {
      error: 'quota_exceeded',
      feature: this.feature,
      used: this.decision.used,
      limit: this.decision.limit,
      requiredPlan: this.requiredPlan,
    };
  }
}
