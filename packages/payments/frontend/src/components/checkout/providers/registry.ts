/**
 * Screen id → flow shape (FUT-596).
 *
 * An adapter declares `checkoutScreen` (see `PaymentProviderAdapter`), the
 * gateway publishes it on every chain entry, and this table says what SHAPE of
 * flow that id is: collected on our page, or finished on the provider's.
 *
 * ## Why the key is a screen id and not a provider name
 *
 * A provider-name switch cannot express reuse — Stone's flow is PagBank's flow,
 * and under a name key that is a duplicated entry rather than one declaration —
 * and it puts vendor knowledge in the frontend, where nothing declares it and
 * no adapter outside this package can extend it. A screen id inverts that: the
 * adapter says what shape its flow is, and any number of providers share one
 * shape by saying the same word.
 *
 * ## Unknown ids resolve, they do not fail
 *
 * An id this bundle does not know falls back to the capability read
 * ({@link handsBuyerOver}). The backend and frontend packages version
 * independently, so a host running a newer server than bundle publishes ids
 * this table has never seen — an ordinary deployment state that must degrade
 * to a working checkout.
 */
import { handsBuyerOver } from "./hands-over";
import type { CheckoutProviderConfig } from "../types";

/** Whether a declared flow hands the buyer over to the provider's page. */
type FlowShape = "on-page" | "hand-off";

/**
 * Every id this bundle knows, by the shape it declares.
 *
 * NULL-PROTOTYPE on purpose. The key is a string that arrives from the server,
 * so a plain object literal would answer `SHAPES['constructor']` with `Object`
 * — truthy, and no shape at all. `Object.create(null)` has no prototype to
 * inherit from, so the only keys are the ones written here.
 */
const SHAPES: Readonly<Record<string, FlowShape>> = Object.assign(
  Object.create(null) as Record<string, FlowShape>,
  {
    /** Collected on our page: a PIX code, or a card typed here. */
    "pix-and-card": "on-page",
    /** Finished on the provider's own page. */
    "hosted-link": "hand-off",
  },
);

/**
 * Does the buyer choose PIX-or-card on the PROVIDER's page rather than on ours?
 *
 * The list asks this before drawing its rows, and offers the one hand-off row
 * when the answer is yes (FUT-596 follow-up). A hand-off store asks the
 * question twice otherwise: once here, where the answer changes nothing —
 * every method mints the same checkout link — and again on the provider's own
 * page, where it is finally binding.
 *
 * A declared id wins; an undeclared or unknown one falls back to the
 * capability read, so a store declaring nothing still gets the right shape.
 */
export function methodChosenAtProvider(
  chainHeadScreen: string | null | undefined,
  config: CheckoutProviderConfig | null,
): boolean {
  const declared = chainHeadScreen ? SHAPES[chainHeadScreen] : undefined;
  if (declared) return declared === "hand-off";
  return handsBuyerOver(config);
}
