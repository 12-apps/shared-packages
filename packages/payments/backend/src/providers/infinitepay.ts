import { ProviderRequestError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type {
  ChargeInput,
  ChargeSnapshot,
  ResolvedCredentials,
} from '../core/types';
import {
  createCheckoutLink,
  customerSchema,
  handleOf,
  paymentCheck,
  NAME,
} from './infinitepay-http';
import { probeFailure } from './infinitepay-probe';
import { infinitePaySetupGuide } from './infinitepay-setup-guide';
import {
  stubCreateFault,
  stubFindCharge,
  stubOutcomeOf,
  stubProbe,
} from './infinitepay-stub';

/**
 * The credential key a SCRIPTED stub store carries — re-exported so a test
 * harness names it once rather than spelling the string in two places that
 * could drift. Read only inside `if (credentials.stub)`; see
 * `infinitepay-stub.ts` for why that makes it inert on a live connection.
 */
export { STUB_OUTCOME_FIELD } from './infinitepay-stub';
import { checkSnapshot, isPaidCheck } from './infinitepay-shared';
import { infinitePayDeliveryReference, parseInfinitePayEvent, verifyInfinitePayWebhook } from './infinitepay-webhook';
import { stubCharge, stubChargeId, stubPendingSnapshot } from './shared';

/**
 * InfinitePay adapter — live against the Checkout Integrado API.
 *
 * **Redirect flow.** Every charge becomes a hosted checkout link; the buyer
 * pays on InfinitePay's page (PIX or card, up to 12x). No card data ever
 * reaches this process, which is why `tokenization: 'REDIRECT'`.
 *
 * **The order reference IS the charge id.** InfinitePay correlates on
 * `order_nsu`, which we set to the host's reference. That makes a charge
 * look-up-able by something we chose, rather than by an id we would have to
 * store from a response.
 *
 * ⚠️ **Deliveries are unsigned.** InfinitePay documents no webhook signature
 * and no API key, and a handle is public information — so an inbound
 * "paid" callback is an unauthenticated claim from an anonymous caller. This
 * adapter therefore treats the delivery as a HINT and re-asks InfinitePay via
 * `payment_check` inside `webhook.verify`. A delivery InfinitePay will not
 * confirm is rejected. That is the whole security model here, and it is why
 * `verify` makes a network call where other adapters do a hash comparison.
 */

/**
 * InfinitePay prices in cents, one line per item.
 *
 * The field is `description`, NOT `name`. It shipped as `name` and InfinitePay
 * rejects the whole request for it — every link, not just some:
 *
 *     422 {"success":false,"message":"Invalid checkout link params",
 *          "errors":{"items":{"0":{"description":["is missing"]}}}}
 *
 * So no InfinitePay checkout could ever be created. It went unnoticed because
 * nothing surfaced the provider's own answer until the activation screen began
 * showing the raw exchange (FUT-463) — the failure was real from the first
 * order, just invisible.
 */
function itemsPayload(input: ChargeInput): Array<Record<string, unknown>> {
  return [
    {
      description: `Pedido ${input.reference}`.slice(0, 120),
      price: input.amount.amountCents,
      quantity: 1,
    },
  ];
}

/**
 * The invoice code (`slug`) `payment_check` insists on, dug out of the link.
 *
 * There is no `slug` FIELD. `POST /links` answers with a single key:
 *
 *     { "url": "https://checkout.infinitepay.io/thompson-moreira/gmTq1EgYrP" }
 *
 * and the invoice code is that last path segment — `gmTq1EgYrP` — sitting after
 * the handle. Reading a field that is never sent left the hint empty, so every
 * confirmation asked `payment_check` a question it will not answer and got
 * "not paid" back for payments that had plainly happened.
 *
 * Returns null rather than guessing when the URL carries no second segment.
 * InfinitePay also mints a `?lenc=<blob>` form with the handle alone, and a
 * handle passed off as an invoice code would be a confidently wrong answer
 * where none is the honest one — the webhook still carries the real slug.
 */
function invoiceSlugOf(link: { url?: string; slug?: string }): string | null {
  if (link.slug) return link.slug;
  if (!link.url) return null;
  try {
    const segments = new URL(link.url).pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? (segments.at(-1) ?? null) : null;
  } catch {
    return null;
  }
}

function linkPayload(
  input: ChargeInput,
  credentials: ResolvedCredentials,
): Record<string, unknown> {
  return {
    handle: handleOf(credentials),
    // Our reference, echoed back on every callback — the correlation key.
    order_nsu: input.reference,
    items: itemsPayload(input),
    customer: {
      name: input.customer.name || undefined,
      email: input.customer.email || undefined,
      phone_number: input.customer.phone || undefined,
    },
    redirect_url: credentials.fields['redirectUrl'] || undefined,
    webhook_url: credentials.fields['notificationUrl'] || undefined,
  };
}

const verifyCredentials: PaymentProviderAdapter['verifyCredentials'] = async (credentials) => {
  if (!credentials.stub && !handleOf(credentials)) {
    return { ok: false, message: 'Handle não configurado.' };
  }
  try {
    // Inside the try, deliberately. A scripted outage THROWS, exactly as the
    // real HTTP layer does, so it flows through the same classifier — a script
    // that returned the verdict directly would skip the code it exists to
    // exercise. And `verifyCredentials` must never throw at all (the port says
    // so), which is a rule the catch is what enforces.
    const scripted = stubOutcomeOf(credentials);
    if (scripted) {
      const answer = stubProbe(scripted);
      if (answer) return answer;
    }
    if (credentials.stub) return { ok: true, message: 'stub mode' };
    // There is no authenticated "whoami" to call — the closest probe is a
    // payment_check for a reference that cannot exist. A valid handle
    // answers "not found"; an invalid one is rejected outright.
    await paymentCheck(credentials, { orderNsu: `verify-${Date.now()}` });
    return { ok: true };
  } catch (error) {
    return probeFailure(error);
  }
};

/**
 * The stub's answer to a look-up, or `undefined` for "not stubbed at all".
 *
 * Three states rather than two, and the third is why this is a function: a
 * scripted `null` means "no such payment, keep waiting", which is a real
 * answer, while "no script here" has to fall through to the live call. Folded
 * into one value those two were indistinguishable and the unpaid answer
 * swallowed the unscripted one.
 */
function scriptedSnapshot(
  credentials: ResolvedCredentials,
  reference: string,
): ChargeSnapshot | null | undefined {
  const scripted = stubOutcomeOf(credentials);
  if (scripted) {
    const answer = stubFindCharge(scripted, reference);
    if (answer !== undefined) return answer;
  }
  return credentials.stub ? null : undefined;
}

/**
 * Reconciliation probe. Trivial here because the host reference IS the charge
 * id: InfinitePay correlates on `order_nsu`, which `createCharge` sets to the
 * reference, so the probe is a plain `payment_check`.
 *
 * "Not found" is genuine proof that no money moved, and that is a stronger
 * statement than it looks. A timed-out `createCharge` may well have left a
 * checkout LINK behind, but a link is not a payment: the buyer only ever sees
 * the URL we actually return, so an orphaned link cannot become a second
 * charge. What matters is whether a PAYMENT exists, and that is exactly what
 * `payment_check` answers.
 *
 * Any other failure propagates, so an InfinitePay outage stops the walk
 * instead of being read as "nothing was charged".
 */
const findChargeByReference: NonNullable<
  PaymentProviderAdapter['findChargeByReference']
> = async (reference, credentials, hints) => {
  const scripted = scriptedSnapshot(credentials, reference);
  if (scripted !== undefined) return scripted;
  try {
    const check = await paymentCheck(credentials, {
      orderNsu: reference,
      // Both are REQUIRED by `payment_check`, and neither can be derived here:
      // `slug` is minted with the link and `transaction_nsu` does not exist
      // until someone pays. Asking with the reference alone is not a weaker
      // question, it is an unanswerable one — it reports "not paid" forever,
      // including for payments that plainly happened.
      slug: hints?.slug,
      transactionNsu: hints?.transactionNsu,
    });
    // NOT PAID IS AN ANSWER, AND THE ANSWER IS "NO CHARGE" — the same `null`
    // the 404/422 branch below returns, for the same reason. This probe exists
    // to establish whether money exists, and a 200 saying it does not is proof
    // of exactly that.
    //
    // Returning the snapshot instead is what permanently broke a store's
    // checkout (FUT-661 follow-up). `checkSnapshot` maps unpaid to a live
    // `PENDING`, which the walk's `LIVE_STATUSES` reads as "the charge exists",
    // so an ambiguous first attempt ADOPTED an answer that meant the opposite
    // and persisted it. The row an unpaid check produces is unpayable by
    // construction — 0 cents, no `hostedCheckoutUrl`, and a `providerChargeId`
    // falling back to our own reference. That last part is what made it fatal
    // rather than merely wrong: InfinitePay names its charge after the
    // reference, so `(provider, providerChargeId)` was now taken for the order,
    // every later attempt collided with the dead row, and the identity guard
    // refused each one. The buyer got CHARGE_MISMATCH forever, with no attempt
    // able to store anything and nothing to reconcile.
    //
    // `getCharge` deliberately keeps the PENDING mapping: "not paid yet" is the
    // honest answer to the buyer's poll about an order's STATE. The probe asks
    // a different question and needs a different answer.
    if (!isPaidCheck(check)) return null;
    return checkSnapshot(check, { reference, currency: 'BRL', slug: hints?.slug });
  } catch (error) {
    const status = error instanceof ProviderRequestError ? error.options.httpStatus : undefined;
    // The handle resolved and there is simply no payment under this
    // reference — proven safe to charge elsewhere.
    if (status === 404 || status === 422) return null;
    throw error;
  }
};

const createCharge: PaymentProviderAdapter['createCharge'] = async (input, credentials) => {
  const scripted = stubOutcomeOf(credentials);
  if (scripted) stubCreateFault(scripted);
  if (credentials.stub) {
    return {
      ...stubCharge(NAME, input),
      status: 'PENDING',
      hostedCheckoutUrl: `https://checkout.example.invalid/stub/${stubChargeId(NAME, input.reference)}`,
    };
  }
  const link = await createCheckoutLink(credentials, linkPayload(input, credentials));
  if (!link.url) {
    throw new ProviderRequestError(NAME, 'InfinitePay não retornou a URL do checkout.', {
      retriable: false,
    });
  }
  const slug = invoiceSlugOf(link);
  return {
    provider: NAME,
    // The reference we sent, so a later look-up needs nothing we did not choose.
    providerChargeId: input.reference,
    // The SAME value, carried as what it actually is. The two being equal here
    // is exactly why the id alone cannot identify a charge for this provider —
    // see `ChargeSnapshot.reference`.
    reference: input.reference,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
    hostedCheckoutUrl: link.url,
    // `payment_check` demands the invoice code, and this response is the ONLY
    // place it appears — a caller that does not keep it here can never confirm
    // the charge it just created.
    ...(slug ? { settlementHints: { slug } } : {}),
    raw: link,
  };
};

// ONE field. `webhookSecret` was offered here and it was a trap: InfinitePay
// sends no headers a merchant can configure, so a stored secret caused the
// verify step to reject every GENUINE delivery — a production store had one
// set, and no notification InfinitePay sent it ever got through. The verify
// step now ignores any stored value; the real control is `payment_check`.
const credentialSchema: PaymentProviderAdapter['credentialSchema'] = [
  {
    key: 'handle',
    label: 'InfiniteTag ($usuario)',
    secret: false,
    required: true,
    // The two flags exist for THIS field: it is short, unchecksummed, and
    // decides which account is paid. Monospace so `0` and `O` are told
    // apart by eye; confirmed on save so the value is read back once more
    // before it starts receiving the store's money.
    mono: true,
    confirmOnSave: true,
    placeholder: '$suatag',
    pattern: '^\\$[a-zA-Z0-9][a-zA-Z0-9._-]{2,}$',
    helperText:
      'Confira caractere por caractere. Mostramos a tag em fonte monoespaçada para você distinguir 0 de O e l de 1.',
  },
];

/**
 * The identity a host used to keep in name-keyed tables, declared by the
 * adapter that owns the facts (FUT-557).
 */
const identity = {
  // Two words to a human, so two words in a URL: the host's per-provider
  // settings page and the checkout return URL both spell it this way. The
  // raw name keeps working as an alias (see the registry), so links minted
  // before this was declared still resolve.
  urlSlug: 'infinite-pay',
  /**
   * The smallest total InfinitePay will mint a link for. Its documentation
   * states no minimum at all, so the API's own refusal is the specification:
   *
   *     422 {"success":false,"message":"Invalid checkout link params",
   *          "errors":{"items":["Total price must be greater than 1"]}}
   *
   * It took two attempts to read, both on screen (the whole reason FUT-463
   * shows the raw provider exchange): the first took that "1" as one CENT and
   * sent two, and the API answered with the identical sentence — which
   * settles it. `price` goes UP in cents, the floor is compared in REAIS, and
   * "greater than 1" is strict, so R$ 1,00 is not enough either. Hence 101 —
   * more than a token, so hosts must name the real figure wherever the
   * activation charge appears rather than promise a cent.
   */
  minimumChargeCents: 101,
  /**
   * This adapter's webhook `verify` IS `payment_check`: deliveries arrive
   * unsigned, so the only way to authenticate one is to re-ask InfinitePay
   * whether the money it announces actually moved. A delivery the host has
   * verified and processed is therefore durable proof of payment — which is
   * exactly what reconciliation reads this flag for. Signature-verified
   * providers must not copy it: their verify proves the sender, not the
   * payment.
   */
  verifyConfirmsPayment: true,
  // The delivery's `order_nsu` — WHICH charge a processed delivery proves (FUT-726).
  referenceOfDelivery: infinitePayDeliveryReference,
} satisfies Partial<PaymentProviderAdapter>;

export function infinitePayProvider(): PaymentProviderAdapter {
  return {
    name: NAME,
    displayName: 'InfinitePay',
    ...identity,
    authMode: 'credentials',
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      // InfinitePay documents no refund endpoint on the checkout API —
      // refunds happen in their app. Declaring false makes the gateway say
      // so uniformly instead of failing at the call.
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'REDIRECT',
      // Proven by a REAL R$0,01 link the owner pays on InfinitePay's page and
      // `payment_check` confirms — a different protocol, the same proof.
      activationCharge: true,
    },
    credentialSchema,
    customerSchema,

    verifyCredentials,
    createCharge,

    async getCharge(providerChargeId, credentials, hints) {
      if (credentials.stub) return stubPendingSnapshot(NAME, providerChargeId);
      // Same four-field demand as `findChargeByReference` — `payment_check`
      // does not answer a partial question, it answers "not paid".
      const check = await paymentCheck(credentials, {
        orderNsu: providerChargeId,
        slug: hints?.slug,
        transactionNsu: hints?.transactionNsu,
      });
      // Same as `findChargeByReference`: the hint must outlive this answer.
      return checkSnapshot(check, {
        reference: providerChargeId,
        currency: 'BRL',
        slug: hints?.slug,
      });
    },

    findChargeByReference,

    webhook: {
      verify: verifyInfinitePayWebhook,
      parse: parseInfinitePayEvent,
    },

    setupGuide: infinitePaySetupGuide,

    clientConfig() {
      // Redirect flow: the client needs nothing but the per-charge
      // `hostedCheckoutUrl` already on the snapshot.
      return { provider: NAME, tokenization: 'REDIRECT' };
    },
  };
}
