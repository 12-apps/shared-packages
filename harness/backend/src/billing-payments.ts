/**
 * The payments gateway `@12-apps/billing/server` charges and vaults through,
 * built the way an adopting host builds one.
 *
 * The frontend harness has an equivalent (`harness/frontend/src/payments/`),
 * and this is deliberately not shared with it: that one runs in a browser and
 * exists to prove the SPA's checkout wire, while this one is a SERVER gateway a
 * server-only package is handed. What they have in common is the rule that
 * matters — only `@12-apps/payments-backend`'s ROOT entry is imported, because
 * a consumer that reached for a vendor subpath would be testing something an
 * adopter cannot do.
 *
 * ## The provider enforces the ownership check, because a real one does
 *
 * `complete` is reached from a browser, so its session id is
 * attacker-controlled and names an object at the PROVIDER rather than in the
 * host's database. The check is `reference`: `begin` stamps it into the
 * session's provider-side metadata, where the browser can neither read nor
 * alter it, and `complete` requires the session to carry it back.
 *
 * `@12-apps/billing`'s whole responsibility at that seam is to pass a reference
 * that came from the HOST's own subscription row rather than from the request.
 * A stub adapter that ignored `reference` would let a broken billing layer pass
 * every test here — so this one keeps its sessions and refuses a mismatch, in
 * the same non-retriable 400 a real adapter raises.
 */
import {
  ProviderRequestError,
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryWebhookInbox,
  createPaymentsGateway,
  defineProviders,
  type MerchantRef,
  type PaymentProviderAdapter,
  type PaymentsGateway,
} from '@12-apps/payments-backend';

/**
 * The PLATFORM's merchant — never a customer's connected account.
 *
 * The inversion this whole surface rests on: everywhere else in a marketplace
 * the customer is the merchant and their buyer is the payer; here the platform
 * is the merchant and the customer is the payer. Charging a customer's own
 * account to pay their subscription would take money from them and hand it
 * straight back.
 */
export const PLATFORM_MERCHANT: MerchantRef = { kind: 'PLATFORM', id: 'plataforma-harness' };

/** Opaque, so no tokenizer recognises it and no vendor SDK is ever reached for. */
export const VAULTING_PROVIDER = 'aurora';
/** Its opposite number: connected, chargeable, and unable to save a card. */
export const CHARGE_ONLY_PROVIDER = 'boreal';

/** One open vault session, as the provider holds it. */
interface StubSession {
  reference: string;
  customerRef: string | null;
}

/** What a suite flips to drive the paths a host cannot provoke from outside. */
export const billingProviders = {
  /** The provider refuses to detach and a retry could plausibly fix it. */
  detachFailsRetriably: false,
  reset(): void {
    billingProviders.detachFailsRetriably = false;
  },
};

function vaultingAdapter(sessions: Map<string, StubSession>): PaymentProviderAdapter {
  let counter = 0;
  return {
    name: VAULTING_PROVIDER,
    async charge(input) {
      return {
        provider: VAULTING_PROVIDER,
        providerChargeId: `ch_${input.idempotencyKey}`,
        status: 'PAID',
        amount: input.amount,
      } as never;
    },
    vault: {
      async begin(input) {
        counter += 1;
        const sessionId = `ses_${counter}`;
        // The stamp. A browser can neither read nor alter it, which is the
        // only reason the check below means anything.
        sessions.set(sessionId, {
          reference: input.reference,
          customerRef: input.customerRef ?? null,
        });
        return {
          provider: VAULTING_PROVIDER,
          tokenization: 'PUBLIC_KEY',
          publicKey: 'pk_harness_public',
          clientSecret: `${sessionId}_secret`,
          sessionId,
        };
      },
      async complete(input) {
        const session = input.sessionId ? sessions.get(input.sessionId) : undefined;
        // Three refusals, all the same shape: a session that never existed, and
        // a session minted for somebody else's subscription. The second is the
        // one that matters — it is what a stranger's session id looks like.
        if (!session || session.reference !== input.reference) {
          throw new ProviderRequestError(
            VAULTING_PROVIDER,
            `${VAULTING_PROVIDER} refused: this session does not belong to that subscription.`,
            { retriable: false, httpStatus: 400 },
          );
        }
        return {
          provider: VAULTING_PROVIDER,
          instrumentId: `vault_${input.sessionId}`,
          customerRef: session.customerRef ?? `cus_${session.reference}`,
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2031,
        };
      },
      async forget() {
        if (billingProviders.detachFailsRetriably) {
          throw new ProviderRequestError(VAULTING_PROVIDER, 'gateway timeout (stub).', {
            retriable: true,
            httpStatus: 503,
          });
        }
      },
    },
  } as PaymentProviderAdapter;
}

/**
 * A provider with NO `vault` seam at all.
 *
 * Not an error state: an operator can fix it by switching acquirer, which is
 * exactly why the package answers `provider-cannot-vault` rather than throwing.
 * A harness with only vaulting providers could never reach that branch.
 */
function chargeOnlyAdapter(): PaymentProviderAdapter {
  return {
    name: CHARGE_ONLY_PROVIDER,
    async charge(input) {
      return {
        provider: CHARGE_ONLY_PROVIDER,
        providerChargeId: `ch_${input.idempotencyKey}`,
        status: 'PAID',
        amount: input.amount,
      } as never;
    },
  } as PaymentProviderAdapter;
}

export interface HarnessBillingPayments {
  gateway: PaymentsGateway;
  credentials: ReturnType<typeof createMemoryCredentialStore>;
  /** Vault sessions the provider is holding — a suite reads it, never writes. */
  sessions: Map<string, StubSession>;
}

/** A connection's stored secrets — opaque, and never read by anything here. */
const STUB_CREDENTIALS = { apiKey: 'sk_harness_stub' } as never;

export function createBillingPayments(): HarnessBillingPayments {
  const sessions = new Map<string, StubSession>();
  const credentials = createMemoryCredentialStore();
  // Both connected; the CHAIN decides which one the platform collects through,
  // and `defaultProvider` is its head. A suite switching acquirer calls
  // `setChain` — the same lever a real rotation pulls — rather than a
  // harness-only override, so what is exercised is the store's own answer.
  credentials.set(PLATFORM_MERCHANT, VAULTING_PROVIDER, STUB_CREDENTIALS);
  credentials.set(PLATFORM_MERCHANT, CHARGE_ONLY_PROVIDER, STUB_CREDENTIALS);
  const gateway = createPaymentsGateway({
    // A RECORD keyed by provider name, not a list: the registry's `has` is what
    // `activeVault` consults, and a chain head it cannot find is a
    // `CredentialsError` rather than a type error.
    providers: defineProviders({
      [VAULTING_PROVIDER]: vaultingAdapter(sessions),
      [CHARGE_ONLY_PROVIDER]: chargeOnlyAdapter(),
    }),
    credentials,
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
  });
  return { gateway, credentials, sessions };
}
