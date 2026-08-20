/**
 * WHO asks the buyer PIX-or-card, and what the Pagamento step does about it.
 *
 * Its own module because the answer is a set of derived facts that must move
 * together: a picker rendered for a store that hands the buyer over, or a
 * hand-off CTA rendered beside a picker, are both a checkout asking one
 * question twice — which is the defect this seam exists to make impossible.
 */
import {
  cardPathAvailable,
  handOffMethod,
  offeredMethods,
  selectableMethods,
  usePreselectSoleMethod,
} from "./method-capability";
import { methodChosenAtProvider } from "./providers/registry";
import type { CheckoutProviderConfig, PaymentMethod } from "./types";

/** What the Pagamento step needs to know about WHO asks the buyer for a method. */
interface MethodChoice {
  /** The store's active provider has no card path in this browser. */
  cardUnavailable: boolean;
  /** The methods the chain declares it can charge, or `null` while unknown. */
  offered: PaymentMethod[] | null;
  /** The choice is made on the provider's page ⇒ render no picker here. */
  atProvider: boolean;
  /**
   * The hand-off screen's "start paying" port, or `undefined` when the picker
   * is on the page and owns that job instead. It SELECTS the store's hand-off
   * method, which is the same event a tile press is — so the auto-raise, the
   * error panel and its retry all keep working with no second code path.
   */
  onStart?: () => void;
}

/**
 * Resolve who asks the buyer PIX-or-card, and preselect a sole method when the
 * question is ours to ask.
 */
export function useMethodChoice(
  config: CheckoutProviderConfig | null,
  method: PaymentMethod | null,
  onMethodChange: (method: PaymentMethod) => void,
): MethodChoice {
  const cardUnavailable = !cardPathAvailable(config);
  const offered = offeredMethods(config);
  const atProvider = methodChosenAtProvider(config?.chain?.[0]?.checkoutScreen, config);
  // Nothing to preselect when the screen owns the choice: the whole point of
  // its button is that the buyer presses it. Preselection exists to spare them
  // a tap that buys them nothing, and here the tap is their consent to LEAVE —
  // taking it for them would redirect a checkout the moment it rendered.
  usePreselectSoleMethod(
    atProvider ? [] : selectableMethods(offered, cardUnavailable),
    method,
    onMethodChange,
  );
  if (!atProvider) return { cardUnavailable, offered, atProvider };
  return {
    cardUnavailable,
    offered,
    atProvider,
    onStart: () => onMethodChange(handOffMethod(offered)),
  };
}
