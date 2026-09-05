import { EN_US_CARD_COPY } from "../../card/en-US";
import { EN_US_CHECKOUT_SCREENS_COPY } from "./screens-en-US";
import type { CheckoutCopy } from "./copy-context";
import type { CheckoutViewCopy, PaymentStatusCopy } from "./view-copy";

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
 *    has to say, because a second payment is the expensive mistake here;
 *  - `dados.secureNotice` is the one reassurance on the details step.
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
  // The step KEYS are the package's own ids; only the labels are words.
  steps: {
    dados: "Details",
    payment: "Payment",
    status: "Confirmation",
  },
  dados: {
    saveProfile: "Save my details for next time",
    cannotContinueTitle: "Could not continue",
    continueAction: "Continue",
    secureNotice: "Secure payment",
    keepShopping: "Keep shopping",
    back: "Back",
  },
  emptyCart: {
    title: "Your cart is empty.",
    action: "See the menu",
  },
  status: EN_US_PAYMENT_STATUS_COPY,
  pipeline: {
    loading: "Loading…",
    // The KEYS are the package's own settlement-method ids, never words.
    awaitingHandover: {
      PIX: "Opening Pix…",
      CARD: "Opening the card payment…",
    },
  },
};
