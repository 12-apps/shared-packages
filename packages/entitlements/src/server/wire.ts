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

/** A framework-neutral response: the adapter serializes it, never reshapes it. */
export interface WireResponse {
  status: number;
  body: Record<string, unknown>;
}

/** The human sentence on every 402 — the machine half rides beside it. */
export const PAYMENT_REQUIRED_MESSAGE = 'Este recurso não está incluído no seu plano.';

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
 */
export function entitlementDenialResponse(
  error: EntitlementRequiredError | QuotaExceededError,
): WireResponse {
  const reason = error instanceof EntitlementRequiredError ? error.decision.reason : null;

  if (reason === 'disabled-by-tenant') {
    return {
      status: 409,
      body: { error: 'Este recurso está desativado nas configurações da loja.' },
    };
  }
  if (reason === 'not-supported') {
    return { status: 404, body: { error: 'Recurso indisponível.' } };
  }

  const { error: code, ...detail } = error.toPayload();
  return {
    status: 402,
    body: { error: PAYMENT_REQUIRED_MESSAGE, code, ...detail },
  };
}
