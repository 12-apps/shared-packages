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
  retryAction: "Try again",
  regenerateAction: "Generate a new code",
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
};
