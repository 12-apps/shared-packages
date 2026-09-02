import type { JSX, ReactNode } from 'react';

import { EN_US_CARD_COPY } from '../../../card/en-US';
import { CheckoutCopyProvider } from '../../../components/checkout/copy-context';
import { EN_US_CHECKOUT_COPY } from '../../../components/checkout/en-US';
import type { ActivationStepCopy } from '../copy';

/**
 * A complete copy pack, in English, for the screens' own tests.
 *
 * Written out in full rather than partially cast, because the point of the port
 * is that it is exhaustive: a pack missing a key would not compile, and that is
 * the property these fixtures have to keep exercising.
 */
export const TEST_COPY: ActivationStepCopy = {
  intro: {
    title: 'Step 3 · Turn on sales',
    cardBody: (amount) => (amount ? `Test charge of ${amount} on your own card.` : 'Test charge on your own card.'),
    realCharge: (amount) => `A real charge of ${amount} will be made.`,
    payingYourself: (amount) => `The ${amount} lands in your own account.`,
  },
  actions: {
    chargeAndActivate: (amount) => (amount ? `Charge ${amount} and activate` : 'Charge and activate'),
    payAndActivate: (amount) => `Pay ${amount} and activate`,
    testAgain: 'Test again',
    retry: 'Retry',
    tryAgain: 'Try again',
    restart: 'Start over',
    generateNewCharge: 'Generate a new charge',
    checkNow: 'Check now',
    alreadyPaidCheckNow: 'I already paid — check now',
    setProviderOrder: 'Set the provider order',
    seePublishedStore: 'See the published store',
  },
  awaiting: {
    receivedTitle: 'Payment received',
    receivedBody: 'Confirming with the provider.',
    declinedTitle: 'That attempt was declined',
    waitingTitle: 'Waiting for the payment',
    waitingBody: (amount) => `We opened a tab to pay ${amount}.`,
    lastChecked: (seconds) => `Last checked ${seconds}s ago`,
    openPaymentPage: 'Open the payment page',
    copyLink: 'Copy the link',
    linkCopied: 'Copied',
    showLink: 'Show the link',
    hideLink: 'Hide the link',
  },
  outcome: {
    approvedTitle: 'Charge approved',
    refundedBody: (amount) => `${amount} was refunded.`,
    refundPendingBody: (amount) => `${amount} is on its way back.`,
    someAmount: 'a small amount',
    authenticatedNotActive: 'Authenticated, but not receiving yet',
    refusedTitle: (name) => `${name} refused to create the charge`,
    refusedBody: (name) => `Check the switch in ${name}.`,
    unreachableTitle: 'We could not reach the provider',
    expiredTitle: 'The charge expired',
    settledTitle: 'Payment confirmed',
    settledBody: (amount) => `${amount} landed in your account.`,
    provenTitle: 'This provider is proven',
    provenBody: 'A real charge has gone through.',
    providerSaid: 'The provider answered:',
    blockedTitle: 'Finish step 2 first',
    blockedBody: 'Confirm the provider-side switch.',
  },
  taxId: {
    label: 'Tax id',
    hint: (displayName: string) => `${displayName} requires the card holder tax id`,
    placeholder: '000.000.000-00',
  },
  charge: {
    card: EN_US_CARD_COPY,
    noTokenizer: 'No card path for {provider}',
    chargeFailed: 'The charge was refused',
    unreachable: 'The request never left the browser',
  },
  redirect: {
    chargeExpired: 'The charge expired',
    confirmFailed: 'We could not confirm the payment',
    createFailed: 'We could not create the charge',
    confirmTimedOut: 'Still valid — we are still checking',
  },
};

/**
 * The host's card-entry providers, standing in for a real adopter's.
 *
 * NOT a passthrough, and that is the contract being exercised: the card fields
 * are the package's own, so they read the checkout copy context, and a host
 * that hands over a bare wrapper gets a throw at the mount rather than a form
 * rendering somebody else's language. This is what `spa-shared/card` already is
 * in the adopting repo — a design-system binding plus that provider.
 */
export function TestCardSurface({ children }: { children: ReactNode }): JSX.Element {
  return <CheckoutCopyProvider copy={EN_US_CHECKOUT_COPY}>{children}</CheckoutCopyProvider>;
}

export const noopValidateTaxId = (): string | undefined => undefined;

/** A host that writes money as plain cents, so assertions read literally. */
export const formatAmount = (cents: number): string => `${cents} cents`;
