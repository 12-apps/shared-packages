/**
 * WHAT A STEP CAN DO, as a context (FUT-1240).
 *
 * A step's `render` is handed only what §4.2 declares — its context, its
 * facts, its slice, and the two navigations. Everything a step needs to CHANGE
 * (choose a method, place the order, report a terminal status, edit the buyer)
 * belongs to the engine, and the engine is the only writer of each.
 *
 * It arrives as a React context rather than as a closure, for one mechanical
 * reason: the registered arrays must be identity-stable across renders (see
 * `stable-plugins.ts`), so a step object cannot be rebuilt each render to
 * capture this render's callbacks. A context is read where it is used, in a
 * component, and leaves the step objects frozen.
 */
import { createContext, useContext, type JSX, type ReactNode } from "react";

import type { CheckoutDecline } from "../../components/checkout/decline";
import type {
  BuyerInfo,
  CheckoutError,
  CheckoutOrder,
  OrderStatus,
} from "../../components/checkout/types";
import type { CheckoutViewCopy } from "../../components/checkout/view-copy";
import type { CheckoutScreens } from "../types";

import type { AnySettlementMethod, CheckoutContext } from "./types";

/** The engine's writers, plus the two tables a step renders from. */
export interface PipelineActions {
  /** Every screen the factory built, already bound to transport and slots. */
  screens: CheckoutScreens;
  /** The words. The engine's own two live under `copy.pipeline`. */
  copy: CheckoutViewCopy;
  /** Every registered settlement method, in picker order. */
  methods: readonly AnySettlementMethod[];
  /** The subset this shopper is actually offered, in the same order. */
  offered: readonly AnySettlementMethod[];
  /** The shopper picked a way to settle. Raises the payable unless a Review owns that. */
  choose(methodId: string): void;
  /** Raise the payable for the chosen method — a `Review`'s own action. */
  place(): void;
  /** A payable is being raised right now. */
  placing: boolean;
  /** "Continuar" on the buyer-details step: gate, persist, advance. */
  continueFromDados(): void;
  setBuyer(buyer: BuyerInfo): void;
  saveProfile: boolean;
  setSaveProfile(save: boolean): void;
  /** A terminal status, carrying the refusal when the charge produced one. */
  resolve(status: OrderStatus, decline?: CheckoutDecline | null): void;
  /**
   * Take up an order this visit did not raise — a resumed on-page charge.
   * Separate from {@link PipelineActions.place} because nothing is being
   * created: the charge exists, and what changes is only which order the walk
   * is about.
   */
  adoptOrder(order: CheckoutOrder): void;
  /** Leave for the host's catalog. */
  exitToCatalog(): void;
  /** The refusal the engine currently holds, whoever claimed it. */
  error: CheckoutError | null;
  /** Reopen the buyer-details step — the payer block's "alterar". */
  editBuyer: (() => void) | undefined;
}

const PipelineActionsContext = createContext<PipelineActions | null>(null);

/** The engine's actions. Throws outside the engine, on purpose. */
export function usePipelineActions(): PipelineActions {
  const actions = useContext(PipelineActionsContext);
  if (!actions) {
    throw new Error(
      "usePipelineActions() was called outside the checkout pipeline. A step's " +
        "render only runs inside <Checkout />; mounting one on its own is what " +
        "`flows.screens.*` is for.",
    );
  }
  return actions;
}

/** Supplied once by the engine, above every step. */
export function PipelineActionsProvider({
  actions,
  children,
}: {
  actions: PipelineActions;
  children: ReactNode;
}): JSX.Element {
  return (
    <PipelineActionsContext.Provider value={actions}>
      {children}
    </PipelineActionsContext.Provider>
  );
}

/** The descriptor for a chosen method, or `undefined` when nobody registered it. */
export function descriptorFor(
  methods: readonly AnySettlementMethod[],
  ctx: CheckoutContext,
): AnySettlementMethod | undefined {
  if (ctx.method === null) return undefined;
  return methods.find((entry) => entry.id === ctx.method);
}
