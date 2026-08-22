/**
 * Every string the legacy checkout views render — required props, with NO
 * defaults, deliberately (the payments extraction's own doctrine, FUT-760):
 * a default in the origin host's language reads as finished to the next host
 * right up until a buyer sees it. These views proved the point — the flows
 * factory's copy port existed, was REQUIRED, declared
 * `unavailableWithRemedyTitle` and `emptyCartAction`, and the views simply
 * never read it, so a host that dutifully passed copy still rendered another
 * product's voice.
 *
 * The store-cannot-charge screen is NOT here any more. It shipped as a second
 * component beside the factory's own — same two branches, but with the origin
 * host's dining room welded into its API (`waiterAvailable`, `onCallWaiter`, a
 * `checkout-call-waiter` test id) and a copy shape whose field names asked
 * every adopter to name a waiter. The factory's screen says the same two
 * things through `CheckoutAvailability.remedy` — a `{ label, onSelect }` the
 * host fills with whatever its own remedy is — so the twin was deleted rather
 * than renamed.
 *
 * A pt-BR host imports {@link PT_BR_CHECKOUT_VIEW_COPY} from `./pt-BR` (the
 * package root re-exports it) and passes it by hand — one reviewable line,
 * never a silence.
 */

/** The stepper's three labels, in flow order. */
export interface CheckoutStepperCopy {
  dados: string;
  payment: string;
  status: string;
}

/** The buyer-details step: its bar, its refusal, and the slim header. */
export interface DadosStepCopy {
  /** The save-my-details checkbox. */
  saveProfile: string;
  /** The refusal Alert's title (its body is the server's own sentence). */
  cannotContinueTitle: string;
  /** The sticky bar's one action. */
  continueAction: string;
  /**
   * The reassurance caption under it. OPTIONAL, on the flows port's
   * `secureNotice` precedent: a host that has not written the sentence gets
   * NO caption rather than someone else's.
   */
  secureNotice?: string;
  /** The slim header's back control, on Dados and after it. */
  keepShopping: string;
  back: string;
}

/** Nothing to check out (cart mode only). */
export interface EmptyCartCopy {
  title: string;
  action: string;
}

/** One outcome's headline and its single supporting line. */
export interface StatusOutcomeCopy {
  heading: string;
  support: string;
}

/**
 * The confirmation screen. Icons and tones stay the component's — they are
 * visual grammar, not language; every SENTENCE is the host's, including the
 * timed-out wait's "do not pay again", which is the one instruction on this
 * screen that matters (FUT-556).
 */
export interface PaymentStatusCopy {
  paid: StatusOutcomeCopy;
  awaiting: StatusOutcomeCopy;
  failed: StatusOutcomeCopy;
  expired: StatusOutcomeCopy;
  awaitingTimedOut: StatusOutcomeCopy;
  retryAction: string;
  regenerateAction: string;
  backAction: string;
  /** The paid receipt's three row labels. */
  amountLabel: string;
  referenceLabel: string;
  receiptEmailLabel: string;
}

/** What the legacy `CheckoutFlow` itself renders and must be handed. */
export interface CheckoutViewCopy {
  steps: CheckoutStepperCopy;
  dados: DadosStepCopy;
  emptyCart: EmptyCartCopy;
  status: PaymentStatusCopy;
}
