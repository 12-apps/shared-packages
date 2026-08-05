import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { VaultedInstrument, VaultSession } from '../core/vault-types';
import { NAME, stripeRequest } from './stripe-http';

/**
 * Stripe card vaulting (FUT-340) — saving a tenant's card for later
 * off-session subscription charges, without charging anything now.
 *
 * A SetupIntent, not a zero-amount charge. Stripe models "authorise this card
 * for future use" as its own object with its own lifecycle, and it is the only
 * flow that produces a `pm_` attached to a customer with the stored-credential
 * agreement recorded on Stripe's side — which is what a later `off_session`
 * charge relies on.
 *
 * The shape is two calls because the middle step happens in the browser:
 *
 *   begin     create (or reuse) the customer, open a SetupIntent, hand the
 *             browser the publishable key and the intent's client secret
 *   ⟨browser⟩ Stripe.js collects the card and confirms the intent; the PAN
 *             never touches this process
 *   complete  re-read the intent from Stripe and return what it attached
 *
 * And, whenever the tenant asks for the card back off file:
 *
 *   forget    detach the payment method from the customer, leaving the
 *             customer itself (and its stored-credential agreement) intact
 */

interface StripeCustomer {
  id?: string;
}

interface StripePaymentMethod {
  id?: string;
  card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
}

interface StripeSetupIntent {
  id?: string;
  status?: string;
  client_secret?: string;
  customer?: string;
  payment_method?: StripePaymentMethod | string;
  /** Stamped by `begin`; the browser can neither read nor alter it. */
  metadata?: Record<string, string>;
}

/**
 * Reuse the tenant's customer, or make one.
 *
 * Reuse matters more than it looks: a second `cus_` per tenant would scatter
 * their instruments across objects, so "replace my card" could leave the old
 * one chargeable under a customer nothing points at any more.
 */
async function customerFor(
  input: { reference: string; customer: { name?: string; email?: string } },
  existing: string | undefined,
  credentials: Parameters<typeof stripeRequest>[1],
): Promise<string> {
  if (existing) return existing;
  const created = await stripeRequest<StripeCustomer>('/v1/customers', credentials, {
    method: 'POST',
    body: {
      name: input.customer.name || undefined,
      email: input.customer.email || undefined,
      // Traces a customer in the Stripe dashboard back to a subscription.
      metadata: { reference: input.reference },
    },
  });
  if (!created.id) {
    throw new ProviderRequestError(NAME, 'Stripe customer response carried no id.', {
      retriable: false,
    });
  }
  return created.id;
}

const begin: NonNullable<PaymentProviderAdapter['vault']>['begin'] = async (
  input,
  credentials,
): Promise<VaultSession> => {
  const customerRef = await customerFor(input, input.customerRef, credentials);
  const intent = await stripeRequest<StripeSetupIntent>('/v1/setup_intents', credentials, {
    method: 'POST',
    body: {
      customer: customerRef,
      payment_method_types: ['card'],
      // The agreement itself: it is what lets a later charge run `off_session`
      // rather than be held for an authentication nobody is there to give.
      usage: 'off_session',
      metadata: { reference: input.reference },
    },
  });
  if (!intent.id || !intent.client_secret) {
    throw new ProviderRequestError(NAME, 'Stripe SetupIntent response was incomplete.', {
      retriable: false,
    });
  }

  return {
    provider: NAME,
    tokenization: 'SDK',
    customerRef,
    publicKey: credentials.fields['publishableKey'],
    clientSecret: intent.client_secret,
    sessionId: intent.id,
  };
};

/** Refuse anything that is not this tenant's own, succeeded, card-bearing intent. */
function assertUsable(
  intent: StripeSetupIntent,
  input: { reference: string; customerRef?: string },
): void {
  // THE ownership check. `sessionId` arrives from a browser and names an object
  // at STRIPE, not in our database — without this a tenant could post someone
  // else's SetupIntent id and attach a stranger's card to their subscription.
  //
  // It is the REFERENCE and not the customer, because the customer does not
  // exist yet on a tenant's first card: `begin` creates it, so `complete` would
  // have nothing to compare against and the check would have to be skipped
  // exactly when the account is newest. The reference is stamped into metadata
  // server-side, where the browser cannot reach it.
  if (intent.metadata?.['reference'] !== input.reference) {
    throw new ProviderRequestError(
      NAME,
      'Stripe SetupIntent does not belong to this subscription.',
      { retriable: false },
    );
  }
  // Belt as well as braces, once the host has a customer to compare.
  if (input.customerRef && intent.customer !== input.customerRef) {
    throw new ProviderRequestError(NAME, 'Stripe SetupIntent names a different customer.', {
      retriable: false,
    });
  }
  if (intent.status !== 'succeeded') {
    throw new ProviderRequestError(
      NAME,
      `Stripe SetupIntent is ${intent.status ?? 'unknown'}, not succeeded.`,
      { retriable: false },
    );
  }
}

const complete: NonNullable<PaymentProviderAdapter['vault']>['complete'] = async (
  input,
  credentials,
): Promise<VaultedInstrument> => {
  if (!input.sessionId) {
    throw new ProviderRequestError(NAME, 'Stripe vault completion needs a SetupIntent id.', {
      retriable: false,
    });
  }

  const intent = await stripeRequest<StripeSetupIntent>(
    `/v1/setup_intents/${encodeURIComponent(input.sessionId)}`,
    credentials,
    // Expanded, or `payment_method` comes back as a bare id and the card's
    // brand/last4 would need a second round trip to show the tenant.
    { method: 'GET', body: { 'expand[]': 'payment_method' } },
  );

  assertUsable(intent, input);

  const method = typeof intent.payment_method === 'object' ? intent.payment_method : undefined;
  if (!method?.id) {
    throw new ProviderRequestError(NAME, 'Stripe SetupIntent attached no payment method.', {
      retriable: false,
    });
  }

  return {
    provider: NAME,
    customerRef: intent.customer,
    instrumentId: method.id,
    brand: method.card?.brand,
    last4: method.card?.last4,
    expMonth: method.card?.exp_month,
    expYear: method.card?.exp_year,
  };
};

/**
 * Detach the payment method, so Stripe stops holding the tenant's card.
 *
 * `detach` and not `customers.delete`: the customer object carries the
 * stored-credential agreement and the tenant's identity at Stripe, and a
 * tenant who removes one card today may add another tomorrow. Deleting the
 * customer would take the agreement with it and orphan any other instrument
 * hanging off it.
 *
 * Every failure is left to propagate as the transport made it. A 4xx here is
 * an id Stripe will not act on, a 5xx is one it might act on next time, and
 * `ProviderRequestError.retriable` already tells those apart — re-reading the
 * body to decide "gone or not" would be this adapter guessing at a policy the
 * host owns.
 */
const forget: NonNullable<NonNullable<PaymentProviderAdapter['vault']>['forget']> = async (
  input,
  credentials,
): Promise<void> => {
  // Stub mode makes no network call, per the adapter contract. Nothing was
  // vaulted at Stripe in stub mode, so there is nothing there to detach.
  if (credentials.stub) return;
  await stripeRequest<StripePaymentMethod>(
    `/v1/payment_methods/${encodeURIComponent(input.instrumentId)}/detach`,
    credentials,
    { method: 'POST' },
  );
};

export const stripeVault: NonNullable<PaymentProviderAdapter['vault']> = {
  begin,
  complete,
  forget,
};
