/**
 * Screen id → screen (FUT-596).
 *
 * The one place the buyer's pane is chosen. An adapter declares
 * `checkoutScreen` (see `PaymentProviderAdapter`), the gateway publishes it on
 * every chain entry, and this table turns it into a component.
 *
 * ## Why the key is a screen id and not a provider name
 *
 * A provider-name switch is the shape this ticket exists to remove. It cannot
 * express reuse — Stone's flow is PagBank's flow, and under a name key that is
 * a duplicated entry rather than one declaration — and it puts vendor
 * knowledge in the frontend, where nothing declares it and no adapter outside
 * this package can extend it. A screen id inverts that: the adapter says what
 * shape its flow is, and any number of providers share one screen by saying
 * the same word. It is the contract `SetupStep.action` already uses one layer
 * up, for the same reason.
 *
 * ## Unknown ids resolve, they do not fail
 *
 * {@link screenFor} returns `null` for an id it does not know, and the caller
 * renders {@link CapabilityDefaultScreen}. This is load-bearing: the backend
 * and frontend packages version independently, so a host running a newer
 * server than bundle will publish ids this table has never seen. That is an
 * ordinary deployment state and it must degrade to a working checkout, never
 * to an empty pane.
 */
import { CapabilityDefaultScreen } from "./capability-default";
import { HostedLinkScreen } from "./hosted-link";
import { PixAndCardScreen } from "./pix-and-card";
import type { ProviderCheckoutScreen } from "./types";

/**
 * Every screen this bundle can render, by the id an adapter declares.
 *
 * NULL-PROTOTYPE on purpose. The key is a string that arrives from the server,
 * so a plain object literal would answer `SCREENS['constructor']` with
 * `Object` and `SCREENS['toString']` with a function — both truthy, neither a
 * component, and the pane would throw mid-render for a store whose declared id
 * happened to collide with `Object.prototype`. `Object.create(null)` has no
 * prototype to inherit from, so the only keys are the ones written here.
 */
const SCREENS: Readonly<Record<string, ProviderCheckoutScreen>> = Object.assign(
  Object.create(null) as Record<string, ProviderCheckoutScreen>,
  {
    /** Collected on our page: a PIX code, or a card typed here. */
    "pix-and-card": PixAndCardScreen,
    /** Finished on the provider's own page. */
    "hosted-link": HostedLinkScreen,
  },
);

/**
 * The screen for a declared id, or `null` when nothing is declared or the id
 * is unknown to this bundle. A `null` answer is not an error — see the module
 * comment.
 */
export function screenFor(id: string | null | undefined): ProviderCheckoutScreen | null {
  if (!id) return null;
  return SCREENS[id] ?? null;
}

/**
 * THE resolution the pane uses: the declared screen, else the capability
 * default. Always returns something renderable, which is AC3.
 *
 * The id is read from the chain's HEAD, because the head is the provider the
 * walk tries first and therefore the flow the buyer is about to enter. A
 * failover to a tail provider happens server-side, after the buyer has already
 * given us everything the charge needs — the card is typed once and minted for
 * every chain entry (FUT-563) — so the pane does not change under them
 * mid-charge, and must not.
 */
export function resolveCheckoutScreen(
  chainHeadScreen: string | null | undefined,
): ProviderCheckoutScreen {
  return screenFor(chainHeadScreen) ?? CapabilityDefaultScreen;
}
