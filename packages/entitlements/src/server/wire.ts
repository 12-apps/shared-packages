/**
 * The wire contract for an entitlement denial — one mapping, owned by the
 * package, consumed by both halves.
 *
 * The frontend's upsell channel parses exactly this shape (status 402, body
 * `code` of `entitlement_required` / `quota_exceeded`, plus `feature`,
 * `reason`, `requiredPlan`, `used`, `limit`). Keeping the producer and the
 * parser in one package is what stops the two ends drifting — the failure
 * mode that splitting one contract across two repositories invites.
 *
 * ⚠️ Not every denial is a 402. Branch on `reason`:
 *
 * | `reason`             | meaning                        | status |
 * |----------------------|--------------------------------|--------|
 * | `not-entitled`       | plan gap → upsell              | 402    |
 * | `restricted`         | dunning; they already paid     | 402, no upsell |
 * | `suspended`          | hard stop; settle up           | 402, no upsell |
 * | `disabled-by-tenant` | THEY turned it off             | 409 — not a payment problem |
 * | `not-supported`      | this build has no such feature | 404    |
 */
import { EntitlementRequiredError, QuotaExceededError } from '../core/errors';
import type { EntitlementDenialMessages } from './copy';

/** A framework-neutral response: the adapter serializes it, never reshapes it. */
export interface WireResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Is this one of the engine's own denial errors? */
export function isEntitlementDenial(
  error: unknown,
): error is EntitlementRequiredError | QuotaExceededError {
  return error instanceof EntitlementRequiredError || error instanceof QuotaExceededError;
}

/**
 * Map an engine denial to its wire response.
 *
 * `toPayload()` names its machine discriminator `error`; this surface's
 * `error` is always the human message. Re-keying it to `code` keeps both
 * instead of the code silently overwriting the sentence.
 *
 * `messages` is the host's — this used to compile one product's sentences in
 * (the exported `PAYMENT_REQUIRED_MESSAGE` constant among them). The pack's
 * `paymentRequired` is the same words for a pt-BR host; a host mapping
 * denials in its own handlers passes the same object it handed the config.
 */
export function entitlementDenialResponse(
  error: EntitlementRequiredError | QuotaExceededError,
  messages: EntitlementDenialMessages,
): WireResponse {
  const reason = error instanceof EntitlementRequiredError ? error.decision.reason : null;

  if (reason === 'disabled-by-tenant') {
    return {
      status: 409,
      body: { error: messages.featureDisabledByTenant },
    };
  }
  if (reason === 'not-supported') {
    return { status: 404, body: { error: messages.featureUnavailable } };
  }

  const { error: code, ...detail } = error.toPayload();
  return {
    status: 402,
    body: { error: messages.paymentRequired, code, ...detail },
  };
}
