import {
  EN_US_INFINITEPAY_SETUP_GUIDE_COPY,
  EN_US_STONE_SETUP_GUIDE_COPY,
  EN_US_STRIPE_SETUP_GUIDE_COPY,
} from './setup-guide-en-US';
import type {
  InfinitePayCopy,
  PagbankCopy,
  ProviderCopyPacks,
  StoneCopy,
  StripeCopy,
  StripeModeFacts,
} from './copy';

/**
 * The en-US packs for the four built-in adapters — NAMED constants a host
 * passes by hand, never a default.
 *
 * PROVIDER nouns are not translated, and that is the rule this whole file
 * turns on. The vendor NAMES (Stripe, Stone/Pagar.me, PagBank, InfinitePay)
 * stay as they are — an owner has to know which of their four dashboards to
 * open — and so do `sk_`, `pk_`, `whsec_`, `InfiniteTag` and
 * `gatewayMerchantId`, which are what they will read in that dashboard. A
 * translated field name sends them hunting for a box that does not exist, the
 * same reason `pagbank-vault.ts` quotes the vendor's own field name verbatim.
 *
 * Naming vendors here is legal precisely because this IS the payments package:
 * `payments/no-provider-name-literal` scopes `packages/payments/**` out, since
 * naming the provider is this package's whole subject.
 */

/** How this pack names the two Stripe modes mid-sentence. */
const MODE_WORD = (live: boolean): string => (live ? 'live' : 'test');

/**
 * What to call the credential that authenticates the charge.
 *
 * A grant and a pasted key are the same thing to the vendor and two different
 * nouns to an owner. The pt-BR pack composes the whole sentence here because
 * the two take different genders in Portuguese; English keeps the same seam so
 * the two packs stay key-for-key comparable.
 */
const SOURCE = (viaGrant: boolean): string => (viaGrant ? 'The authorisation' : 'The secret key');

export const EN_US_STRIPE_COPY: StripeCopy = {
  setupGuide: EN_US_STRIPE_SETUP_GUIDE_COPY,
  unreachable:
    'We could not reach Stripe just now. ' +
    'Your credentials are saved — test the connection again in a moment.',
  fields: {
    connectedAccountHelp:
      'Leave this blank. Fill it in only if you are a Connect platform charging on behalf of another account — with your own keys, this field makes the connection be refused.',
  },
  refused: (detail) =>
    detail ? `Credentials refused by Stripe: ${detail}` : 'Credentials refused by Stripe.',
  checks: {
    chargesDisabled: (viaGrant, accountId) =>
      `${SOURCE(viaGrant)} works${accountId ? ` (account ${accountId})` : ''}, but charges are ` +
      'not enabled on this account yet. Finish the business details in the Stripe dashboard — ' +
      'until then every charge is refused.',
    secretKeyModeMismatch: (viaGrant, mode: StripeModeFacts) =>
      `${SOURCE(viaGrant)} is a ${MODE_WORD(mode.key)} key, but this connection is configured as ` +
      `${MODE_WORD(mode.connection)}. Use the key for the matching environment.`,
    secretKeyResolved: (viaGrant, accountId) =>
      `${SOURCE(viaGrant)} answers for account ${accountId}.`,
    secretKeyAccepted: (viaGrant) => `${SOURCE(viaGrant)} was accepted by Stripe.`,
    publishableKeyMissing:
      'Without the publishable key the browser cannot tokenise cards, so card checkout does ' +
      'not work for this store.',
    publishableKeyShape: 'That does not look like a publishable key — it starts with `pk_`.',
    publishableKeyModeMismatch: (mode) =>
      `The publishable key is ${MODE_WORD(mode.key)} and this connection is ${MODE_WORD(mode.connection)}. ` +
      "The buyer's card would be refused with no explanation.",
    publishableKeyOk: (live) =>
      `A ${MODE_WORD(live)} publishable key, matching this connection's environment.`,
    webhookSecretViaGrant:
      "Accounts connected by authorisation use the platform's endpoint — there is nothing to register.",
    webhookSecretMissing:
      'Without the signing secret, payment confirmations from Stripe will be refused.',
    webhookSecretShape: 'That does not look like a signing secret — it starts with `whsec_`.',
    webhookSecretShapeOnly:
      'The format is right. Stripe offers no way to check that the secret is the correct one — ' +
      'that only shows up on the first notification received.',
    connectedAccountMismatch: (resolved, declared) =>
      `The key given answers for account ${resolved}, not ${declared}. ` +
      'One of the two is wrong — and it is the one that decides which account the money reaches.',
    connectedAccountOk: (declared) => `Matches the account the key resolves to (${declared}).`,
    severalFailed: (count, firstMessage) =>
      `${count} credentials need attention. ${firstMessage}`,
  },
};

export const EN_US_STONE_COPY: StoneCopy = {
  setupGuide: EN_US_STONE_SETUP_GUIDE_COPY,
  unreachable:
    'We could not reach Stone/Pagar.me just now. ' +
    'Your credentials are saved — test the connection again in a moment.',
  secretKeyMissing: 'No secret key configured.',
  refused: 'Key refused by Stone/Pagar.me.',
  // Field labels quote the vendor's own dashboard, prefixes included.
  fields: {
    secretKey: 'Secret key (sk_...)',
    publicKey: 'Public key (pk_...)',
    webhookUser: 'Webhook username',
    webhookPassword: 'Webhook password',
  },
  // These two reach the BUYER — on a printed slip and on a bank statement —
  // so they are the store's words to its own customers.
  payer: { boletoInstructions: 'Pay by the due date', statementDescriptor: 'ORDER' },
};

export const EN_US_PAGBANK_COPY: PagbankCopy = {
  unreachable:
    'We could not reach PagBank just now. ' +
    'Your credentials are saved — test the connection again in a moment.',
  tokenMissing: 'No token configured.',
  refused: 'Token refused by PagBank.',
  fields: {
    token: 'PagBank token',
    publicKey: 'Public key (card)',
    webhookToken: 'Webhook token',
    // `gatewayMerchantId` is the vendor's own parameter name, kept verbatim.
    googlePayMerchantId: 'Google Pay: merchant id (gatewayMerchantId)',
  },
  payer: { lineItemName: 'Order' },
};

export const EN_US_INFINITEPAY_COPY: InfinitePayCopy = {
  setupGuide: EN_US_INFINITEPAY_SETUP_GUIDE_COPY,
  unreachable:
    'We could not reach InfinitePay just now. Your tag is saved — test the connection again in a moment.',
  handleMissing: 'No handle configured.',
  tagNotFound: 'We could not find that InfiniteTag on InfinitePay. Check the tag in the app and try again.',
  refused: 'Handle refused by InfinitePay.',
  noCheckoutUrl: 'InfinitePay returned no checkout URL.',
  handleHelp:
    'Check it character by character. We show the tag in a monospaced font so you can tell 0 from O and l from 1.',
  fields: { handle: 'InfiniteTag ($username)' },
};

/**
 * All four packs together, for a host that wants this wording everywhere — and
 * the shape `allProviderAdapters` takes.
 *
 * Still one line in the host's diff, and still nothing this package reaches for
 * on its own.
 */
export const EN_US_PROVIDER_COPY: ProviderCopyPacks = {
  pagbank: EN_US_PAGBANK_COPY,
  stone: EN_US_STONE_COPY,
  infinitepay: EN_US_INFINITEPAY_COPY,
  stripe: EN_US_STRIPE_COPY,
};
