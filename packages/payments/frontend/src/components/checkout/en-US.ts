import { EN_US_CARD_COPY } from "../../card/en-US";
import { EN_US_CHECKOUT_SCREENS_COPY } from "./screens-en-US";
import type { CheckoutCopy } from "./copy-context";
import type { ShortPaymentCopy } from "./short-copy";
import type { CheckoutViewCopy, PaymentStatusCopy } from "./view-copy";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const AND = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/**
 * A capture that arrived short, and a full one the store could not fulfil
 * (FUT-612). Read by somebody whose money ARRIVED: none of these says
 * "nothing was charged". A host charging in another currency passes its own
 * `money`.
 */
export const EN_US_SHORT_PAYMENT_COPY: ShortPaymentCopy = {
  money: (cents) => USD.format(cents / 100),
  methodNames: { PIX: "Pix", CARD: "Card", BOLETO: "Boleto" },
  heading: ({ due }) => `${due} still to pay to complete the order`,
  support: ({ paid, total }) =>
    `We received ${paid} of the order's ${total}. Pay only the difference to confirm it, ` +
    "or ask the store to return what was paid.",
  totalLabel: "Order total",
  paidLabel: (method) => `Already paid (${method})`,
  dueLabel: "Still to pay",
  payAction: ({ due }) => `Pay ${due}`,
  refundAction: ({ paid }) => `Cancel and get ${paid} back`,
  reviewing: ({ paid }) => ({
    heading: "The store is checking your payment",
    support: `We received ${paid}. The store will confirm the order or return the money; you will be told.`,
  }),
  refunded: ({ paid }) => ({
    heading: `The store returned ${paid}`,
    support: "The money goes back the way you paid it.",
  }),
  refundPending: ({ paid }) => ({
    heading: `We are returning ${paid}`,
    support: "The refund is under way; you will be told when the money is back.",
  }),
  settled: {
    heading: "Order confirmed",
    support: "The store received the rest of the payment and confirmed the order.",
  },
  stockGone: ({ received, missing }) => ({
    heading: `We received ${received}, but ${missing} ran out.`,
    support: "The store will confirm or return the money; you will be told.",
  }),
  joinMissing: (names) => AND.format(names),
};

/**
 * The en-US packs for the checkout views — NAMED exports a host passes by hand,
 * never defaults.
 *
 * Four of these sentences carry a promise rather than a description, and the
 * translation keeps each one FIRST in its block, because the fear on this
 * screen is having been charged for an order that failed:
 *
 *  - `failed.support` and `expired.support` both open by saying nothing was
 *    charged;
 *  - `awaitingTimedOut.support` says "do not pay again" before anything else it
 *    has to say, because a second payment is the expensive mistake here.
 */
export const EN_US_PAYMENT_STATUS_COPY: PaymentStatusCopy = {
  paid: {
    heading: "Order confirmed",
    support: "We have your payment and the order is recorded.",
  },
  awaiting: {
    heading: "Confirming your payment",
    support: "This usually takes a few seconds. You can leave this screen open.",
  },
  failed: {
    heading: "Payment not completed",
    support: "Nothing was charged. You can try again.",
  },
  expired: {
    heading: "The code expired",
    support: "Nothing was charged. Generate a new code to carry on.",
  },
  manual: {
    failed: {
      heading: "The store did not find your Pix",
      support: "If you have already paid, talk to the store before paying again.",
    },
    expired: {
      heading: "The store did not confirm the payment in time",
      support: "If you have already paid, talk to the store before paying again.",
    },
  },
  awaitingTimedOut: {
    heading: "We have not had the confirmation yet",
    support:
      "If you have already paid, the order is confirmed as soon as the provider tells us — " +
      "do not pay again. You can close this screen.",
  },
  awaitingUnreachable: {
    heading: "We cannot reach the payment right now",
    // "do not pay again" leads the second sentence for the same reason it
    // leads `awaitingTimedOut`: a second payment is the expensive mistake.
    support:
      "We are still trying. If you have already paid, do not pay again — " +
      "the order is confirmed as soon as the provider tells us.",
  },
  /**
   * One refusal at a time, in the cardholder's own terms (FUT-1145).
   *
   * `UNKNOWN` is deliberately absent: with no recognised reason there is
   * nothing specific to say, and `failed` above is already that sentence.
   */
  declined: {
    INSUFFICIENT_FUNDS: {
      heading: "There were not enough funds",
      support: "Nothing was charged. Try another card.",
    },
    CARD_DECLINED: {
      heading: "Your bank did not authorise the payment",
      support: "Nothing was charged. Try another card, or talk to your bank.",
    },
    INVALID_CARD: {
      heading: "The card details were not accepted",
      support: "Nothing was charged. Check the number, the expiry and the CVV, or use another card.",
    },
    EXPIRED_CARD: {
      heading: "That card has expired",
      support: "Nothing was charged. Use a card that is still in date.",
    },
    FRAUD_SUSPECTED: {
      heading: "Your bank blocked this purchase for security",
      support: "Nothing was charged. Talk to your bank, or use another card.",
    },
    PROVIDER_ERROR: {
      heading: "We could not process the payment right now",
      support: "Nothing was charged. Try again in a moment.",
    },
  },
  retryAction: "Try again",
  regenerateAction: "Generate a new code",
  checkAgainAction: "Check again",
  notPaidAction: "I could not pay",
  backAction: "Back to the menu",
  amountLabel: "Amount paid",
  referenceLabel: "Order",
  receiptEmailLabel: "Receipt sent to",
  short: EN_US_SHORT_PAYMENT_COPY,
};

/**
 * The words the checkout's deeper screens read from context — the card form,
 * its tokenizers, and the buyer-details step's own fields.
 */
export const EN_US_CHECKOUT_COPY: CheckoutCopy = {
  card: EN_US_CARD_COPY,
  screens: EN_US_CHECKOUT_SCREENS_COPY,
  buyer: {
    emailInvalid: "That e-mail address is not valid.",
    emailRequired: "E-mail is required.",
    nameRequired: "Name is required.",
    phoneRequired: "Phone is required.",
    // The list of REQUIRED field names is the host's configuration, so the
    // sentence is built around it — and it inflects on how many there are,
    // which is why this is a function rather than a template.
    fieldsHint: (names) =>
      names.length === 0
        ? "Name, e-mail and phone are optional — they are only used for the receipt."
        : `Enter your ${names.join(", ")} (${names.length === 1 ? "required" : "required"} ` +
          "for payment). The other fields are optional — they are only used for the receipt.",
  },
};

export const EN_US_CHECKOUT_VIEW_COPY: CheckoutViewCopy = {
  screens: EN_US_CHECKOUT_COPY,
  consent: {
    saveProfile: "Save my details for next time",
  },
  emptyCart: {
    title: "Your cart is empty.",
    action: "See the menu",
  },
  status: EN_US_PAYMENT_STATUS_COPY,
};
