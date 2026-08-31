/**
 * ONE-CLICK checkout — the buyer who already decided (FUT-1070).
 *
 * A storefront can offer a BUY button beside a product or a past order: press
 * it and the shopper expects to have bought, not to be handed a form. The
 * whole flow that follows already exists — Pagamento raises the order, the
 * card path charges a saved instrument, Confirmação reports the outcome — and
 * every step of it is a tap the buyer has already made by pressing that
 * button. So one-click makes those taps, in order, and reaches the same
 * terminal screen through the same code the ordinary flow uses.
 *
 * That reuse is the design, not an economy. A second charge path would be a
 * second answer to "what does paying with a saved card do", and the two would
 * eventually disagree about failover instruments, the unresolved-charge rule,
 * or the poll cap — each of which is money.
 *
 * ## It arms, or it stands down. It never guesses.
 *
 * `armedFor` is the whole decision, and every clause narrows toward
 * NOT arming, because the failure directions are not symmetric: standing down
 * costs a buyer the taps they would have made anyway, and arming wrongly
 * charges a card nobody chose.
 *
 * - **No request** — the host did not ask. This is every ordinary checkout.
 * - **No CPF on file** — the buyer still has a Dados step to fill (FUT-465),
 *   so there is no tap to skip and the flow opens where it always did. In
 *   practice a buyer with a saved card has one; a buyer without one is a buyer
 *   we have never charged.
 * - **No protocol yet** (`config === null`, still loading or a fetch blip) —
 *   the ordinary flow fails OPEN here and renders a picker the server may
 *   refuse, which costs a tap. Arming on the same guess would raise a charge.
 * - **The choice is not ours to ask** — a store that finishes on the
 *   provider's own page has no card path in this browser at all, and the one
 *   thing one-click must never do is redirect a checkout the moment it
 *   renders. This is the InfinitePay shape, and it is why a store on a hosted
 *   provider degrades to the ordinary hand-off screen with nothing else
 *   changed.
 * - **No card path** — the chain declares no CARD entry this browser can mint
 *   or charge for.
 *
 * The last condition cannot be answered here at all: **whether the buyer has a
 * saved card**. That list is fetched by the card path itself, scoped to the
 * store, and asking for it twice would be two answers to one question. So an
 * armed flow selects the card tile and the card view does the rest —
 * {@link useOneClickPay} pays only once a SAVED card is the selection, which
 * is a state the picker can only reach after the list came back non-empty. A
 * buyer with no saved card therefore lands on Pagamento with the picker and
 * the card form, which is exactly the ordinary step 2.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type JSX,
  type ReactNode,
} from "react";

import { cardPathAvailable } from "./method-capability";
import { methodChosenAtProvider } from "./providers/registry";
import type { CheckoutProviderConfig, PaymentMethod } from "./types";

/**
 * Whether the flow above this subtree is running as one-click.
 *
 * CONTEXT rather than a prop, because the consumer is the card path — four
 * layers down, behind the published `ProviderCheckoutScreen` contract that
 * every provider screen implements. Threading a flag through it would widen a
 * contract that three screens share for the benefit of one, and would oblige
 * an out-of-tree screen to forward a prop it has no use for.
 */
const OneClickContext = createContext(false);

/** Arm (or explicitly disarm) one-click for everything below. */
export function OneClickProvider({
  armed,
  children,
}: {
  armed: boolean;
  children: ReactNode;
}): JSX.Element {
  return <OneClickContext.Provider value={armed}>{children}</OneClickContext.Provider>;
}

/** Whether this subtree is a one-click checkout. `false` outside a provider. */
export function useOneClickArmed(): boolean {
  return useContext(OneClickContext);
}

/**
 * Can this store honour a one-click request right now? See the module comment
 * for why every clause narrows toward `false`.
 *
 * `step` is what keeps the answer honest over TIME rather than only at mount:
 * a resumed hosted return opens on Confirmação, and a buyer who walked back to
 * Dados is a buyer who took over. Neither is a checkout that should still be
 * charging on its own.
 */
function armedFor(input: OneClickFlow): boolean {
  const { requested, config, taxIdOnFile, step } = input;
  if (!requested || !taxIdOnFile || step !== "payment" || !config) return false;
  if (methodChosenAtProvider(config.chain?.[0]?.checkoutScreen, config)) return false;
  return cardPathAvailable(config);
}

/** What the flow knows that decides whether one-click may run, and how it starts. */
interface OneClickFlow {
  /** The host asked for one-click on this checkout. */
  requested: boolean;
  /** The store's published protocol; `null` while it is still unknown. */
  config: CheckoutProviderConfig | null | undefined;
  /** The buyer's CPF is already saved, so there is no Dados step to fill. */
  taxIdOnFile: boolean;
  /** Which step the flow is showing — one-click only ever runs on Pagamento. */
  step: string;
  /** The method currently selected, or `null` before any choice. */
  method: PaymentMethod | null;
  /** Selecting a method — the same event a picker tile press is. */
  setMethod: (method: PaymentMethod) => void;
}

/**
 * Arm one-click for this render, and take the card tile for the buyer ONCE
 * when it is armed.
 *
 * Selecting a method is what raises the order (`useAutoRaiseOrder`), so that
 * one call starts everything downstream — and it is the same event a tile
 * press is, which is why nothing else in the flow has to change.
 *
 * Once only, by ref. `setMethod` clears any order raised for a previous
 * method, so a re-fire would discard a live charge and raise a second; and a
 * buyer who switches to PIX after this ran must be allowed to stay there.
 */
export function useOneClick(flow: OneClickFlow): boolean {
  const armed = armedFor(flow);
  const { method, setMethod } = flow;
  const taken = useRef(false);
  useEffect(() => {
    if (!armed || taken.current || method !== null) return;
    taken.current = true;
    setMethod("CARD");
  }, [armed, method, setMethod]);
  return armed;
}

/**
 * Press "Pagar" for the buyer, ONCE, when a saved card is what is selected.
 *
 * `ready` is the caller's whole precondition and is deliberately narrow: a
 * SAVED card is the current selection and no charge is in flight, has landed,
 * or has already failed. It can only become true after the instrument list
 * came back with something, which is what makes "the buyer has no saved card"
 * a silent stand-down rather than a branch.
 *
 * The submit is held in a ref because `handlePay` is rebuilt every render;
 * depending on it directly would re-run this effect constantly and leave the
 * once-only guard as the only thing between a shopper and a second charge.
 * One guard for one job: the ref fires it, `fired` decides whether it may.
 *
 * A DECLINE is terminal for one-click, and that is the point of listing
 * `error` in `ready`: the buyer's own "Pagar R$ …" comes back under the
 * refusal, and retrying a declined card automatically is how a shopper gets
 * three identical declines they never asked for.
 */
export function useOneClickPay(input: {
  armed: boolean;
  ready: boolean;
  pay: () => Promise<void>;
}): void {
  const { armed, ready } = input;
  const submit = useRef(input.pay);
  submit.current = input.pay;
  const fired = useRef(false);
  useEffect(() => {
    if (!armed || !ready || fired.current) return;
    fired.current = true;
    void submit.current();
  }, [armed, ready]);
}
