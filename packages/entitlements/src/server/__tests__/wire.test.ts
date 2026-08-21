// @vitest-environment node
/**
 * The denial wire, pinned VERBATIM — statuses, machine keys and the pt-BR
 * sentences a customer actually reads. The whole reason both halves live in
 * one package is that neither the machine half nor the human half may drift.
 *
 * The sentences are the HOST's (required `messages`); this suite passes the
 * pt-BR pack and pins that the mapping puts each of its sentences on the
 * right status — and that they name nothing outside the surface: not a tier,
 * not a currency, and not what a tenant is (they used to say "da loja", one
 * host's word for its customers).
 */
import { describe, expect, it } from 'vitest';

import { EntitlementRequiredError, QuotaExceededError } from '../../core/errors';
import type { EntitlementDecision, QuotaDecision } from '../../core/types';
import { PT_BR_ENTITLEMENTS_MESSAGES } from '../pt-BR';
import { entitlementDenialResponse } from '../wire';

function decision(over: Partial<EntitlementDecision<string>>): EntitlementDecision<string> {
  return {
    feature: 'forecast.history',
    enabled: false,
    reason: 'not-entitled',
    policy: 'hide',
    limit: null,
    requiredPlan: 'network',
    ...over,
  };
}

describe('entitlementDenialResponse', () => {
  it('answers a plan gap with 402 — the human sentence beside the machine half', () => {
    const denial = entitlementDenialResponse(
      new EntitlementRequiredError('t1', decision({})),
      PT_BR_ENTITLEMENTS_MESSAGES,
    );
    expect(denial.status).toBe(402);
    expect(denial.body).toEqual({
      error: 'Este recurso não está incluído no seu plano.',
      code: 'entitlement_required',
      feature: 'forecast.history',
      reason: 'not-entitled',
      requiredPlan: 'network',
    });
    // The pack's key IS the sentence — a host reusing the pack must get the
    // same words the routes produce.
    expect(denial.body.error).toBe(PT_BR_ENTITLEMENTS_MESSAGES.paymentRequired);
  });

  it("answers the tenant's own switch with 409 and its own sentence — never a payment problem", () => {
    const denial = entitlementDenialResponse(
      new EntitlementRequiredError(
        't1',
        decision({ reason: 'disabled-by-tenant', requiredPlan: null }),
      ),
      PT_BR_ENTITLEMENTS_MESSAGES,
    );
    expect(denial.status).toBe(409);
    expect(denial.body).toEqual({
      error: 'Este recurso está desativado nas configurações.',
    });
    expect(denial.body.error).not.toContain('loja');
  });

  it('answers not-supported with 404 — a key this build cannot serve is not for sale', () => {
    const denial = entitlementDenialResponse(
      new EntitlementRequiredError(
        't1',
        decision({ reason: 'not-supported', requiredPlan: null }),
      ),
      PT_BR_ENTITLEMENTS_MESSAGES,
    );
    expect(denial.status).toBe(404);
    expect(denial.body).toEqual({ error: 'Recurso indisponível.' });
  });

  it('answers a spent quota with 402, used/limit riding along', () => {
    const quota: QuotaDecision<string> = {
      ...decision({ feature: 'crew.seats', enabled: true, reason: 'enabled', limit: 3 }),
      used: 3,
      remaining: 0,
      exceeded: true,
    };
    const denial = entitlementDenialResponse(
      new QuotaExceededError('t1', quota),
      PT_BR_ENTITLEMENTS_MESSAGES,
    );
    expect(denial.status).toBe(402);
    expect(denial.body).toEqual({
      error: 'Este recurso não está incluído no seu plano.',
      code: 'quota_exceeded',
      feature: 'crew.seats',
      used: 3,
      limit: 3,
      requiredPlan: 'network',
    });
  });
});
