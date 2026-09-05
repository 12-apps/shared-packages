/**
 * THE ENGINE'S OWN STATE, and the one writer of each fact (FUT-1240).
 *
 * Everything here is state a STEP reads and only the engine writes. Which step
 * the shopper is on is deliberately NOT among them — that is derived (see
 * `derive-step.ts`), which is the whole point of the pipeline.
 *
 * `slices` lives here rather than inside each step because the engine owns the
 * storage: one `useState` for every step's scrap, so the number of hooks does
 * not depend on how many steps a host registered.
 */
import { useCallback, useMemo, useState } from "react";

import type { CheckoutDecline } from "../../components/checkout/decline";
import type {
  BuyerInfo,
  CheckoutError,
  CheckoutOrder,
  OrderStatus,
} from "../../components/checkout/types";

import { initialSlices, writeSlice } from "./slices";
import type { AnyCheckoutStep, CheckoutContext } from "./types";

/** What one visit accumulates. */
export interface EngineState {
  buyer: BuyerInfo;
  /**
   * The shopper has edited the buyer form, so the host's saved defaults must
   * stop overwriting it. Until they have, the defaults are adopted live —
   * a profile that arrives after mount still prefills the form it is for.
   */
  buyerTouched: boolean;
  saveProfile: boolean;
  order: CheckoutOrder | null;
  outcome: OrderStatus | null;
  decline: CheckoutDecline | null;
  /** The refusal the engine holds, routed to whoever claimed its code. */
  error: CheckoutError | null;
  placing: boolean;
  slices: Record<string, unknown>;
  /** A step the shopper pressed BACK into; it wins while it still applies. */
  reopened: string | null;
}

/** The state, plus the only two ways to change it. */
export interface EngineStore {
  state: EngineState;
  patch(next: Partial<EngineState>): void;
  setSlice(stepId: string, value: unknown): void;
}

/** Everything at rest, with each step's slice rehydrated or freshly built. */
function freshState(
  steps: readonly AnyCheckoutStep[],
  ctx: CheckoutContext,
): EngineState {
  return {
    buyer: ctx.buyer,
    buyerTouched: false,
    // The "salvar meus dados" consent starts checked, exactly as the flat
    // controller's does — the checkbox is the shopper's way to say otherwise.
    saveProfile: true,
    order: null,
    outcome: null,
    decline: null,
    error: null,
    placing: false,
    slices: initialSlices(steps, ctx),
    reopened: null,
  };
}

/**
 * The engine's store.
 *
 * `steps` and the initial `ctx` are read ONCE, in the lazy initializer: the
 * slices a step declared are seeded from storage at mount, and re-seeding them
 * on a later render would undo whatever the shopper has since done.
 */
export function useEngineStore(
  steps: readonly AnyCheckoutStep[],
  ctx: CheckoutContext,
): EngineStore {
  const [state, setState] = useState<EngineState>(() => freshState(steps, ctx));
  const tenantSlug = ctx.tenantSlug;
  const patch = useCallback((next: Partial<EngineState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);
  const setSlice = useCallback(
    (stepId: string, value: unknown) => {
      const step = steps.find((entry) => entry.id === stepId);
      if (step) writeSlice(step, tenantSlug, value);
      setState((current) => ({ ...current, slices: { ...current.slices, [stepId]: value } }));
    },
    [steps, tenantSlug],
  );
  return useMemo(() => ({ state, patch, setSlice }), [state, patch, setSlice]);
}

/**
 * The buyer the walk should show: the shopper's own edits once they have made
 * any, and the host's saved defaults until then.
 */
export function effectiveBuyer(state: EngineState, defaults: BuyerInfo): BuyerInfo {
  return state.buyerTouched ? state.buyer : defaults;
}
