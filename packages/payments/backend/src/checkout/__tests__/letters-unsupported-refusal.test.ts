/**
 * FUT-590 — when a provider documents a CNPJ of digits only (Stripe's boleto)
 * and the buyer gave an alphanumeric one, the buyer is told so, in the owner's
 * words: "Este pagamento ainda não aceita CNPJ com letras." Never the generic
 * "não é válido" — the document IS valid, and saying otherwise sends the buyer
 * to re-type a correct CNPJ.
 */
import { describe, expect, it } from 'vitest';

import { CustomerRequirementsError, NoProviderSucceededError } from '../../core/errors';
import type { CustomerFieldIssue } from '../../core/customer-schema';
import { EN_US_CHECKOUT_COPY } from '../copy-en-US';
import { PT_BR_CHECKOUT_COPY } from '../copy-pt-BR';
import { checkoutRefusalFor, type FailureContext } from '../failure';
import type { CheckoutCopy } from '../copy';

const LETTERS: CustomerFieldIssue = { field: 'taxId', reason: 'INVALID', required: true, detail: 'LETTERS_UNSUPPORTED' };
const MALFORMED: CustomerFieldIssue = { field: 'taxId', reason: 'INVALID', required: true };

function context(copy: CheckoutCopy): FailureContext {
  const quiet = () => undefined;
  return { copy, log: { warn: quiet, error: quiet, providerFailure: quiet }, ref: 'payable-1', method: 'BOLETO' };
}

describe('a CNPJ with letters where the payment takes digits only', () => {
  it.each([
    ['pt-BR', PT_BR_CHECKOUT_COPY, 'Este pagamento ainda não aceita CNPJ com letras.'],
    ['en-US', EN_US_CHECKOUT_COPY, 'This payment does not accept a CNPJ with letters yet.'],
  ])('says so in %s when the charge is pinned to the provider', (_locale, copy, sentence) => {
    const refusal = checkoutRefusalFor(context(copy), new CustomerRequirementsError('stripe', [LETTERS]));
    expect(refusal.status).toBe(400);
    expect(refusal.body).toEqual({ code: 'INVALID_BUYER_FIELD', message: sentence, field: 'cpf' });
  });

  it('says so when every provider in the chain was skipped for it', () => {
    const error = new NoProviderSucceededError([{ provider: 'stripe', message: 'gate', kind: 'GATE', issues: [LETTERS] }]);
    expect(checkoutRefusalFor(context(PT_BR_CHECKOUT_COPY), error).body.message).toBe('Este pagamento ainda não aceita CNPJ com letras.');
  });

  it('keeps the generic sentence for a document that is really malformed', () => {
    const refusal = checkoutRefusalFor(context(PT_BR_CHECKOUT_COPY), new CustomerRequirementsError('pagbank', [MALFORMED]));
    expect(refusal.body.message).toBe(PT_BR_CHECKOUT_COPY.buyerFieldInvalid('taxId'));
    expect(refusal.body.message).not.toContain('letras');
  });
});
