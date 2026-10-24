import { describe, expect, it } from 'vitest';

import { EN_US_STRIPE_COPY } from '../en-US';
import { PT_BR_STRIPE_COPY } from '../pt-BR';
import { stripeProvider } from '../stripe';

const labels = (adapter: ReturnType<typeof stripeProvider>) => {
  const schema = typeof adapter.credentialSchema === 'function'
    ? adapter.credentialSchema({ locale: null })
    : adapter.credentialSchema;
  return Object.fromEntries((schema ?? []).map((field) => [field.key, field.label]));
};

// The four Stripe credential boxes were labelled in English on every
// screen, whatever pack the host passed.
describe('the Stripe credential field labels', () => {
  it('come from the copy pack', () => {
    expect(labels(stripeProvider(PT_BR_STRIPE_COPY))).toMatchObject({
      secretKey: 'Chave secreta (sk_...)',
      publishableKey: 'Chave publicável (pk_...)',
      webhookSecret: 'Segredo de assinatura do webhook (whsec_...)',
      connectedAccountId: 'Conta conectada (acct_...)',
    });
  });

  it('keep the English wording in the English pack', () => {
    expect(labels(stripeProvider(EN_US_STRIPE_COPY)).secretKey).toBe('Secret key (sk_...)');
  });
});
