import type { CheckoutCopy } from "./copy-context";
import type { CheckoutDeclineReason } from "./decline";

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
  /**
   * A refusal with nothing more specific to say. Still the whole of what a
   * buyer reads when the server sent no `declineReason`, or sent one this
   * bundle has never heard of — see {@link PaymentStatusCopy.declined}.
   */
  failed: StatusOutcomeCopy;
  expired: StatusOutcomeCopy;
  /**
   * What a REFUSED CARD says, per normalized reason (FUT-1145).
   *
   * The server has classified declines since FUT-340 and then discarded the
   * classification on the wire, so an expired card, a card reported stolen, no
   * funds, and "attempts exhausted — do not retry" all reached the buyer as one
   * sentence offering a retry that could not work. Each of those asks something
   * different of the person holding the phone, and only they can act on it.
   *
   * A reason with no entry — a newer server, a host mid-migration — falls back
   * to {@link PaymentStatusCopy.failed}, which is exactly today's screen.
   */
  declined: Partial<Record<CheckoutDeclineReason, StatusOutcomeCopy>>;
  awaitingTimedOut: StatusOutcomeCopy;
  /**
   * The wait cannot reach the payment right now (FUT-1144) — and is STILL
   * ASKING, which is the whole difference between this outcome and the one
   * above it, and why the one above it wins when a screen somehow has both. The
   * resumed hosted return used to render neither: its poll could fail forever
   * and the screen went on saying "isso costuma levar alguns segundos" under a
   * spinner, so the one leg with no PIX or card view of its own was also the
   * one that never mentioned a problem.
   */
  awaitingUnreachable: StatusOutcomeCopy;
  retryAction: string;
  regenerateAction: string;
  /**
   * "I did not pay" — the buyer's own way out of a wait with no terminal state
   * (FUT-1146).
   *
   * A cancelled or refused payment on a provider's own page produces NO signal
   * anywhere: the provider's check publishes `success` and `paid` and nothing
   * else, an unpaid webhook delivery fails verification before it is parsed,
   * and no server-side writer of FAILED is reachable from it. So the screen
   * waited fifteen minutes and then told someone who had never paid not to pay
   * again. The only signal that exists is this one, and it is safe to act on
   * because the server re-asks the provider before letting anything go.
   */
  notPaidAction: string;
  /**
   * Ask now, rather than waiting for the next automatic poll — and, once the
   * wait has run out, the only thing that starts it again.
   */
  checkAgainAction: string;
  backAction: string;
  /** The paid receipt's three row labels. */
  amountLabel: string;
  referenceLabel: string;
  receiptEmailLabel: string;
}

/**
 * The pipeline engine's own two sentences (FUT-1240).
 *
 * REQUIRED, both of them, and stated here rather than defaulted for the reason
 * every other string in this file is: a default in the origin host's language
 * reads as finished right up until a shopper sees it. These two are the whole
 * of what the ENGINE renders on its own account — everything else on screen
 * belongs to a step, a gate or a settlement method.
 */
export interface CheckoutPipelineCopy {
  /**
   * What is on screen while the checkout has nothing to show yet: a gate still
   * deciding, the store's protocol still in flight, or no step applying.
   *
   * It replaces a blank frame. A shopper who taps "pagar" and gets an empty
   * page taps again.
   */
  loading: string;
  /**
   * PER SETTLEMENT METHOD, what the shopper reads between choosing it and the
   * surface that takes the money arriving — the hand-off interstitial's own
   * line. Keyed by `SettlementMethodDescriptor.id`.
   *
   * Per method because the sentences are not interchangeable: a Pix hand-off
   * and a card challenge send the shopper to different places for different
   * reasons, and one shared "aguarde" describes neither. A method with no
   * entry falls back to {@link CheckoutPipelineCopy.loading}, which is what a
   * host registering a new charged method gets until it writes the sentence.
   */
  awaitingHandover: Readonly<Record<string, string>>;
}

/** What the legacy `CheckoutFlow` itself renders and must be handed. */
export interface CheckoutViewCopy {
  steps: CheckoutStepperCopy;
  dados: DadosStepCopy;
  emptyCart: EmptyCartCopy;
  status: PaymentStatusCopy;
  /**
   * The engine's own two sentences (FUT-1240). Carried here, beside the
   * stepper labels, so a host still answers copy exactly once — the pipeline
   * is another way of rendering this same checkout, not a second surface.
   */
  pipeline: CheckoutPipelineCopy;
  /**
   * The words the screens BELOW these read — the card fields, the wallet
   * panes, the buyer-details inputs (FUT-760).
   *
   * Carried here rather than as a second prop so a host still passes copy
   * exactly once. `CheckoutFlow` mounts it as `CheckoutCopyProvider`, because
   * threading it down through four intermediate components as props is how a
   * copy port comes to exist, be required, and go unread — which is what
   * happened to `unavailableWithRemedyTitle` before this port was finished.
   */
  screens: CheckoutCopy;
}
