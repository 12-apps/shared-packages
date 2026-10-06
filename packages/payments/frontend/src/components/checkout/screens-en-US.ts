import type { CheckoutScreensCopy } from './screens-copy';

/**
 * The en-US pack for the buyer's checkout screens — a NAMED constant a host
 * passes by hand, never a default.
 *
 * Two entries here are LOCALE TAGS rather than words, and they move with the
 * pack because they decide how the same screen renders a time and a wallet
 * button: `pix.expiryLocale` formats the "valid until" clock, and
 * `wallet.googlePay.buttonLocale` is the language Google's own button renders
 * itself in. A pack whose sentences were English and whose clock was
 * Portuguese would be a screen written for nobody.
 *
 * PIX, CPF, Apple Pay and Google Pay all keep their names: the first two are
 * Brazilian schemes the buyer will look for by name in their banking app, and
 * the last two are the vendors' own product names, rendered by the vendors'
 * own buttons.
 */
export const EN_US_CHECKOUT_SCREENS_COPY: CheckoutScreensCopy = {
  method: {
    groupLabel: 'Payment method',
    pixLabel: 'Pix',
    cardLabel: 'Card',
    pixDescription: 'Approved instantly',
    pixManualDescription: 'Confirmed by the store',
    cardDescription: 'Credit, paid in full',
    unavailableHere: 'Not available at this store',
  },
  settling: {
    cannotConfirm: 'Could not confirm the payment',
    takingLonger: 'The payment is taking longer than expected',
    // "do not make another payment" is the load-bearing half: a second payment
    // is the expensive mistake on this screen.
    takingLongerHelp:
      'You can wait, or check your order again shortly — do not make another payment.',
    processing: 'Processing payment…',
    confirming: 'We are confirming your payment',
    cannotPay: 'Could not pay',
    // "we keep trying" is the load-bearing half: the wait has not ended, and a
    // shopper who reads a final-sounding refusal pays a second time.
    connectionLost: 'No connection right now — we keep trying',
    checkAgainAction: 'Check again',
  },
  pix: {
    heading: 'Pay with Pix',
    qrAlt: 'PIX QR code for payment',
    copyAction: 'Copy code',
    copiedAction: 'Copied!',
    copyAgainAction: 'Copy again',
    showQrAction: 'Show QR code',
    preferCardAction: 'Rather pay by card?',
    verifying: 'Checking automatically…',
    tabsLabel: 'How to pay the Pix',
    copyPasteTab: 'Copy and paste',
    qrTab: 'QR code',
    qrHeading: 'On your phone',
    copyPasteHeading: 'Pix copy and paste',
    or: 'or',
    qrInstructions: 'Open your banking app on your phone, choose **Pix › Scan QR code** and point it at the screen.',
    qrTabCaption: 'Scan it with the banking app on another phone.',
    copyPasteHint: 'Paste it into your banking app under **Pix copy and paste**.',
    internetBankingHint: 'Paying through internet banking? Paste the code under **Pix copy and paste**.',
    notPaidYet: 'Not paid yet?',
    scanFromPhone: 'Scan it with the banking app on your phone.',
    validUntil: (time) => `Valid until ${time}. Confirmation is automatic.`,
    expiryLocale: 'en-US',
    awaiting: 'Waiting for payment…',
    chargeMissing: 'Could not generate the PIX code.',
    afterCopy: {
      title: 'Waiting for the payment',
      body: (totalLabel, wide) =>
        `As soon as the bank confirms the payment of ${wide ? `**${totalLabel}**` : totalLabel}, your order shows up here. You can leave this ${wide ? 'page' : 'screen'} open.`,
      stepCopied: 'Pix code copied',
      stepPay: (wide) =>
        wide ? 'Pay in your banking app or internet banking (Pix copy and paste)' : 'Pay in your banking app (Pix copy and paste)',
      stepConfirm: () => 'The bank confirms the payment automatically',
    },
    manual: {
      validUntil: (time) => `The store confirms the payment by ${time}.`,
      awaiting: 'Waiting for the store to confirm…',
      afterCopy: {
        title: 'Waiting for the store',
        body: (totalLabel, wide) =>
          `As soon as the store confirms it received ${wide ? `**${totalLabel}**` : totalLabel}, your order shows up here. You can leave this ${wide ? 'page' : 'screen'} open.`,
        stepCopied: 'Pix code copied',
        stepPay: (wide) =>
          wide ? 'Pay in your banking app or internet banking (Pix copy and paste)' : 'Pay in your banking app (Pix copy and paste)',
        stepConfirm: (time) => `The store confirms the payment — by ${time}`,
      },
    },
  },
  card: {
    heading: 'Pay by card',
  },
  payer: {
    taxId: (formatted) => `CPF ${formatted}`,
    taxIdAlreadyKnown: 'CPF already on file',
    payingAs: (name) => `Paying as ${name}`,
    payingWithSavedDetails: 'Paying with your saved details',
    changeAction: 'Change',
  },
  error: {
    confirming: 'We are confirming your payment',
    cannotContinue: 'Could not continue',
    retryAction: 'Try again',
    emailLabel: 'E-mail for the payment',
    // Lower-case and fragmentary: it renders as a hint under the field.
    emailMustDifferHint: "use an e-mail address different from the store's",
    useEmailAction: 'Use this e-mail and continue',
  },
  wallet: {
    applePay: {
      orderTotal: 'Order total',
      cannotStart: 'Could not start Apple Pay in this store. Pay by card instead.',
      cannotComplete: 'Could not start Apple Pay. Try again, or pay by card.',
      payAction: 'Pay with Apple Pay',
    },
    googlePay: {
      cannotComplete: 'Could not complete the payment with Google Pay. Try again, or pay by card.',
      // Google's button renders itself in this language; it takes a bare
      // language subtag, not a full BCP-47 tag.
      buttonLocale: 'en',
    },
    orPayWithCard: 'or pay by card',
  },
  hosted: {
    // Five fragments the screen composes into one sentence, so each keeps its
    // leading preposition and none reads as a sentence on its own.
    destinationNamed: (displayName) => `to ${displayName}'s payment page`,
    destinationGeneric: "to the provider's secure payment page",
    methodsChoice: (methods) => `, where you choose to pay with ${methods}`,
    pixAndCard: 'PIX or card',
    pixOnly: 'PIX',
    cardOnly: 'card',
    handoff: (destination, choice) => `You will be taken ${destination}${choice}.`,
    afterwards:
      'Once the payment goes through, you come back here and we confirm the order.',
    startAction: 'Continue to payment',
    preparing: 'Preparing the payment',
  },
  transport: {
    failed: 'Could not complete the operation. Try again.',
    invalidResponse: 'Invalid response from the server.',
    offline: 'Could not connect. Check your connection and try again.',
  },
  validation: {
    taxIdInvalid: 'That CPF is not valid.',
    nameRequired: 'Enter your name.',
    emailInvalid: 'That e-mail address is not valid.',
    phoneInvalid: 'That phone number is not valid.',
    required: 'This field is required.',
  },
  generatingPayment: 'Generating payment…',
  totalCaption: (items) => `Total · ${items} ${items === 1 ? 'item' : 'items'}`,
};
