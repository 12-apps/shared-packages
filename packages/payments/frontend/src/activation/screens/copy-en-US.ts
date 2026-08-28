import { EN_US_CARD_COPY } from '../../card';

import type { ActivationStepCopy } from './copy';

/**
 * The twin of `./copy-pt-BR.ts`, key for key (FUT-764).
 *
 * A pack, not a default — see that file for the whole argument, and for the
 * list of strings that deliberately do not move across the pair: **Checkout
 * Integrado** (PagBank's own console label), **CPF** and its `000.000.000-00`
 * mask (a Brazilian document and a FORMAT), the provider names, and this
 * package's `{provider}` placeholder.
 */
export const EN_US_ACTIVATION_STEP_COPY: ActivationStepCopy = {
  intro: {
    title: 'Step 3 · Turn selling on',
    cardBody: (amountLabel) =>
      `Make a test charge${amountLabel ? ` of ${amountLabel}` : ''} on your own card. It is ` +
      'refunded automatically, and it is what proves your shop can genuinely take money.',
    realCharge: (amountLabel) =>
      `We raise a real ${amountLabel} charge on your own account. Paying it is what proves your ` +
      'shop can genuinely take money.',
    payingYourself: (amountLabel) =>
      `You are paying yourself: the ${amountLabel} leaves your payment method and lands in the ` +
      "account that receives this shop's sales. There is no refund because the money never left " +
      'your control.',
  },
  actions: {
    chargeAndActivate: (amountLabel) =>
      `Charge${amountLabel ? ` ${amountLabel}` : ''} and activate`,
    payAndActivate: (amountLabel) => `Pay ${amountLabel} and activate`,
    testAgain: 'Test again',
    retry: 'Try again',
    tryAgain: 'Try once more',
    restart: 'I have switched it on — restart Step 3',
    generateNewCharge: 'Generate a new charge',
    checkNow: 'Check now',
    alreadyPaidCheckNow: 'I have paid — check now',
    setProviderOrder: 'Set the order between providers',
    seePublishedStore: 'See the published shop',
  },
  awaiting: {
    receivedTitle: 'Payment received — confirming',
    receivedBody:
      'We are confirming your payment with the provider. This usually takes a few seconds.',
    declinedTitle: 'The payment was declined',
    waitingTitle: 'Waiting for the payment…',
    waitingBody: (amountLabel) =>
      `We raised the ${amountLabel} charge and opened the provider's page in another tab. ` +
      'Pay there and come back: we check for ourselves the moment it lands.',
    lastChecked: (seconds) => `Last checked ${seconds}s ago`,
    openPaymentPage: 'Open the payment page',
    copyLink: 'Copy the link',
    linkCopied: 'Link copied',
    showLink: 'Show the link',
    hideLink: 'Hide the link',
  },
  outcome: {
    approvedTitle: 'Test charge approved',
    refundedBody: (amountLabel) =>
      `Your shop can take payments. The ${amountLabel} was refunded automatically.`,
    refundPendingBody: (amountLabel) =>
      `Your shop can take payments. The ${amountLabel} refund did not complete — ` +
      'it will show up on your statement.',
    someAmount: 'amount',
    authenticatedNotActive: 'Authenticated, but not activated',
    refusedTitle: (displayName) => `${displayName} refused to create the charge`,
    refusedBody: (displayName) =>
      `${displayName} refused to create the charge. That almost always means ` +
      'Checkout Integrado is still switched off on your account. Nothing was charged — ' +
      'we reopened Step 2 above: turn it on there and come back.',
    unreachableTitle: 'We could not reach the provider',
    expiredTitle: 'The charge expired',
    settledTitle: 'Test charge confirmed',
    settledBody: (amountLabel) =>
      `Your shop can take payments. The ${amountLabel} stays in your account — ` +
      'InfinitePay refunds are made in their own app.',
    provenTitle: 'Test charge confirmed',
    provenBody:
      'Your shop has proved it can take money through this provider. We switched sales ' +
      'on automatically — you can pause them with the button at the top whenever you like. ' +
      'No further charge is needed.',
    providerSaid: 'The provider answered:',
    blockedTitle: 'Step 2 is still unconfirmed',
    blockedBody:
      'Confirm above that Checkout Integrado is enabled on your account. Without it the ' +
      'provider creates no payment link at all, and this charge would fail.',
  },
  taxId: {
    label: "Cardholder's CPF",
    hint: 'PagBank requires it on every card charge.',
    placeholder: '000.000.000-00',
  },
  charge: {
    card: EN_US_CARD_COPY,
    noTokenizer:
      'Card tokenization is not implemented for {provider} yet, ' +
      'so the verification charge cannot be made from here.',
    chargeFailed: 'The test charge could not be completed.',
    unreachable: 'Could not connect. Check your connection and try again.',
  },
  redirect: {
    chargeExpired: 'The charge expired.',
    confirmFailed: 'The test charge could not be confirmed.',
    createFailed: 'The test charge could not be raised.',
    confirmTimedOut:
      'We could not confirm the payment in time. If you have already paid, the charge is ' +
      'still valid — reload the page to check again.',
  },
};
