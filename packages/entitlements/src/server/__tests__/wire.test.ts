// @vitest-environment node
/**
 * The denial wire, pinned VERBATIM — statuses, machine keys and the pt-BR
 * sentences a customer actually reads. This is line-for-line future-pay's
 * `paymentRequired` mapping, and the whole reason both halves live in one
 * package is that neither the machine half nor the human half may drift.
 */
import { describe, expect, it } from 'vitest';

import { EntitlementRequiredError, QuotaExceededError } from '../../core/errors';
import type { EntitlementDecision, QuotaDecision } from '../../core/types';
import { entitlementDenialResponse, PAYMENT_REQUIRED_MESSAGE } from '../wire';

function decision(over: Partial<EntitlementDecision<string>>): EntitlementDecision<string> {
  return {
    feature: 'audit',
    enabled: false,
    reason: 'not-entitled',
    policy: 'hide',
    limit: null,
    requiredPlan: 'pro',
    ...over,
  };
}

describe('entitlementDenialResponse', () => {
  it('answers a plan gap with 402 — the human sentence beside the machine half', () => {
    const denial = entitlementDenialResponse(
      new EntitlementRequiredError('t1', decision({})),
    );
    expect(denial.status).toBe(402);
    expect(denial.body).toEqual({
      error: 'Este recurso não está incluído no seu plano.',
      code: 'entitlement_required',
      feature: 'audit',
      reason: 'not-entitled',
      requiredPlan: 'pro',
    });
    // The exported constant IS the sentence — a host reusing it must get the
    // same words the routes produce.
    expect(denial.body.error).toBe(PAYMENT_REQUIRED_MESSAGE);
  });

  it("answers the tenant's own switch with 409 and its own sentence — never a payment problem", () => {
    const denial = entitlementDenialResponse(
      new EntitlementRequiredError(
        't1',
        decision({ reason: 'disabled-by-tenant', requiredPlan: null }),
      ),
    );
    expect(denial.status).toBe(409);
    expect(denial.body).toEqual({
      error: 'Este recurso está desativado nas configurações da loja.',
    });
  });

  it('answers not-supported with 404 — a key this build cannot serve is not for sale', () => {
    const denial = entitlementDenialResponse(
      new EntitlementRequiredError(
        't1',
        decision({ reason: 'not-supported', requiredPlan: null }),
      ),
    );
    expect(denial.status).toBe(404);
    expect(denial.body).toEqual({ error: 'Recurso indisponível.' });
  });

  it('answers a spent quota with 402, used/limit riding along', () => {
    const quota: QuotaDecision<string> = {
      ...decision({ feature: 'team.seats', enabled: true, reason: 'enabled', limit: 3 }),
      used: 3,
      remaining: 0,
      exceeded: true,
    };
    const denial = entitlementDenialResponse(new QuotaExceededError('t1', quota));
    expect(denial.status).toBe(402);
    expect(denial.body).toEqual({
      error: 'Este recurso não está incluído no seu plano.',
      code: 'quota_exceeded',
      feature: 'team.seats',
      used: 3,
      limit: 3,
      requiredPlan: 'pro',
    });
  });
});
