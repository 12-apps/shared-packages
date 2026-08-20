/**
 * The buyer checkout SCREEN contract (FUT-596).
 *
 * A screen owns the pane where the buyer actually pays — the PIX code, the card
 * form, the hand-off notice — and nothing else. Everything shared stays in the
 * shell: the stepper, the payer summary, the method picker, the totals, the
 * error surfaces, the polling cadence and the terminal `onResolved` hop to
 * Confirmação. That split is what lets a vendor's flow differ in the one place
 * it genuinely differs without forking a checkout.
 *
 * Which screen renders is resolved from an id the ADAPTER declares
 * (`PaymentProviderAdapter.checkoutScreen`, published per chain entry), so
 * neither the shell nor any host names a provider to get here. See
 * `./registry.ts`.
 */
import type { JSX } from "react";

import type {
  BuyerInfo,
  CheckoutOrder,
  CheckoutProviderConfig,
  OrderStatus,
  PaymentMethod,
} from "../types";

/**
 * What every screen is handed. Every field is already a prop of `PaymentStep`,
 * so resolving a screen threads nothing new through the shell.
 */
export interface ProviderCheckoutScreenProps {
  /**
   * The raised payable, or `null` before the buyer has chosen a method.
   *
   * `null` is a real state a screen must render, not a loading artefact: it is
   * the moment a hand-off screen says where the buyer is about to be sent.
   */
  order: CheckoutOrder | null;
  buyer: BuyerInfo;
  /**
   * The store's protocol, RAW — not pre-narrowed to the card path's view.
   *
   * The shell used to hand the pane `cardTokenization(config)` and
   * `cardChain(config)` directly. Both are card-shaped readings, and a screen
   * whose provider takes no card here must not be given one: it would describe
   * a store that mints instruments when this one does not. Screens that need
   * those readings call the helpers themselves.
   */
  config: CheckoutProviderConfig | null;
  /**
   * What the shell currently has selected; `null` before a choice.
   *
   * `null` is also the resting state of a screen that OWNS the choice (see
   * {@link ProviderCheckoutScreenProps.onStart}): nothing is selected until
   * the buyer presses that screen's own CTA.
   */
  method: PaymentMethod | null;
  /**
   * Present ⇒ this screen owns the "how do I start paying" affordance, because
   * the shell has hidden its method picker for it (FUT-596 follow-up). Calling
   * it commits the buyer to the store's hand-off method and raises the charge,
   * exactly as choosing a tile in the picker does.
   *
   * Absent for every screen where the picker is still on the page — those
   * screens must not grow a second way to start the same charge.
   */
  onStart?: () => void;
  /** A charge is being raised right now — the shell's own busy flag. */
  creating?: boolean;
  /** Scopes the saved-card list to the store being paid. */
  tenantSlug?: string;
  /** The shell's polling cadence, passed through so tests can shorten it. */
  pollIntervalMs?: number;
  /**
   * The host's Apple Pay merchant-validation port (FUT-472): exchange the
   * session's `validationURL` for an Apple merchant session, SERVER-SIDE —
   * the merchant identity certificate must never reach a browser. Optional;
   * absent, the Apple Pay sheet cannot start and the pane says so while the
   * card form stays the way to pay.
   */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  /** A terminal status — the shell moves to Confirmação. */
  onResolved: (status: OrderStatus) => void;
}

/**
 * A screen is a plain component. `null` is a legal render (nothing to show
 * yet), which is what the pane did for every provider before FUT-596.
 */
export type ProviderCheckoutScreen = (
  props: ProviderCheckoutScreenProps,
) => JSX.Element | null;
