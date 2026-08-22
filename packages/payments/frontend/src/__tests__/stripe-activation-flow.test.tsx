// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { activationFlowOf } from '@12-apps/payments-backend';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';
import type { MerchantSettingsView } from '@12-apps/payments-backend';

import { tokenizerFor } from '../card/tokenize';
import type { PaymentsSettingsClient } from '../client';
import {
  PaymentProviderSettings,
  type PaymentProviderSettingsProps,
} from '../components/PaymentProviderSettings';
import { PT_BR_STRIPE_COPY } from '@12-apps/payments-backend';

/**
 * Which activation flow a host renders for Stripe (FUT-689).
 *
 * A host's activation step branches exactly once: a provider with no browser
 * tokenizer gets the hosted-redirect flow (the buyer pays on the provider's
 * own page), anything else gets the card form. Stripe is an SDK provider with
 * the `stripe-pm` tokenizer written (FUT-698), so BOTH halves of the decision
 * — the frontend's tokenizer table and the backend's capability-derived
 * branch — must answer CARD. A drift between them is a dead activation screen:
 * a card form Stripe could satisfy replaced by a link it will never mint.
 */

const stripe = stripeProvider(PT_BR_STRIPE_COPY);

/** The real adapter as the settings API would describe it — nothing invented. */
const VIEW = {
  providers: [
    {
      name: stripe.name,
      displayName: stripe.displayName,
      urlSlug: stripe.name,
      capabilities: stripe.capabilities,
      authMode: stripe.authMode ?? 'credentials',
      credentialSchema: stripe.credentialSchema,
    },
  ],
  configs: [
    {
      provider: stripe.name,
      status: 'VERIFIED',
      enabled: false,
      chargeVerifiedAt: null,
      environment: 'SANDBOX',
      environments: { SANDBOX: {}, PRODUCTION: {} },
    },
  ],
  activeProvider: null,
} as unknown as MerchantSettingsView;

function fakeClient(): PaymentsSettingsClient {
  return {
    getSettings: async () => VIEW,
    getSetupGuide: async () => null,
  } as unknown as PaymentsSettingsClient;
}

/**
 * The canonical host branch, verbatim (the origin host's `VerificationCharge`):
 * no tokenizer ⇒ the hosted-redirect verification, tokenizer ⇒ the card form.
 */
const hostActivationStep: NonNullable<PaymentProviderSettingsProps['renderVerification']> = (ctx) =>
  tokenizerFor(ctx.provider) ? (
    <div data-testid="activation-card-flow">{`Pague R$ 0,01 com cartão — ${ctx.displayName}`}</div>
  ) : (
    <div data-testid="activation-redirect-flow">{`Pague no site — ${ctx.displayName}`}</div>
  );

afterEach(cleanup);

describe('stripe activation flow (FUT-689)', () => {
  it('Stripe never renders the hosted-redirect activation flow', async () => {
    render(
      <PaymentProviderSettings
        client={fakeClient()}
        initialProvider={stripe.name}
        renderVerification={hostActivationStep}
      />,
    );

    const card = await screen.findByTestId('activation-card-flow');
    expect(card.textContent).toContain('Stripe');
    await waitFor(() => expect(screen.queryByTestId('activation-redirect-flow')).toBeNull());
  });

  it('both halves of the branch agree: tokenizer written, capability answers CARD', () => {
    // The frontend's table: the host's redirect branch (`!tokenizerFor(p)`)
    // can never fire for stripe.
    expect(tokenizerFor(stripe.name)).toBe('stripe-pm');
    // The backend's capability-derived branch (FUT-558) says the same.
    expect(activationFlowOf(stripe)).toBe('CARD');
  });
});
