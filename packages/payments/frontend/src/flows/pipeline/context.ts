/**
 * THE CONTEXT EVERY PLUGIN READS, built once from the host's own hooks
 * (FUT-1240).
 *
 * One builder, used by BOTH the engine and `flows.useAdmission()`, so the
 * headless admission the cart drawer asks and the checkout the shopper reaches
 * cannot disagree about the same shopper. That was the whole harm behind
 * "three exemption sets": every surface answered "may this store take money"
 * from its own reading of its own facts.
 *
 * Every field is server-owned or parked. Nothing here is React state the
 * engine happens to hold — the engine layers its own on top with
 * {@link withCheckoutState}, and only there.
 */
import type { CheckoutOrder } from "../../components/checkout/types";

import { useResolvedConfig, type FlowsRuntime } from "../runtime";

import type { CheckoutContext, CheckoutPipelineConfig } from "./types";

/** No host `useIntent` ⇒ no one-click, no resume request, no preset method. */
const NO_INTENT: CheckoutContext["intent"] = Object.freeze({
  oneClick: false,
  resuming: false,
  presetMethod: null,
});

/** No host `useOpenPayable` ⇒ the server is never asked; the park still answers. */
const NO_OPEN_PAYABLE: { order: CheckoutOrder | null; pending: boolean } = Object.freeze({
  order: null,
  pending: false,
});

/**
 * The two reads only a HOST can answer: what the address bar asked for, and
 * what the server says is already in flight.
 *
 * Its own function so the defaulting stays in one place — and so the base
 * builder below reads as a list of facts rather than as a chain of `??`.
 */
function usePipelineReads(pipeline: CheckoutPipelineConfig): {
  intent: CheckoutContext["intent"];
  openPayable: { order: CheckoutOrder | null; pending: boolean };
} {
  const intent = pipeline.useIntent?.() ?? NO_INTENT;
  const openPayable = pipeline.useOpenPayable?.() ?? NO_OPEN_PAYABLE;
  return { intent, openPayable };
}

/** The base context plus the two reads a caller may need on their own. */
interface CheckoutBase {
  ctx: CheckoutContext;
  openPayable: { order: CheckoutOrder | null; pending: boolean };
  /** The buyer's saved details are still being fetched. */
  buyerPending: boolean;
}

/**
 * The host's facts, as a context.
 *
 * `method`, `order`, `outcome` and `slices` are at their resting values here:
 * an admission decision is about the SHOPPER and the STORE, never about how
 * far into a payment somebody is. The engine supplies the rest.
 */
export function useCheckoutBase(
  runtime: FlowsRuntime,
  pipeline: CheckoutPipelineConfig,
): CheckoutBase {
  const cart = runtime.config.useCart();
  const defaults = runtime.config.useBuyerDefaults?.() ?? {};
  const settlement = runtime.config.useSettlement?.() ?? null;
  const { config, pending } = useResolvedConfig(runtime);
  const tenantSlug = runtime.useTenantSlug();
  const { intent, openPayable } = usePipelineReads(pipeline);
  return {
    ctx: {
      ...(tenantSlug === undefined ? {} : { tenantSlug }),
      config,
      configPending: pending,
      cart,
      settlement,
      ...buyerFacts(defaults),
      ...AT_REST,
      order: openPayable.order,
      intent,
    },
    openPayable,
    buyerPending: defaults.pending ?? false,
  };
}

/** Nothing has been chosen, raised or answered yet. */
const AT_REST = Object.freeze({
  method: null,
  outcome: null,
  slices: Object.freeze({}),
} as const);

/** The buyer half, with the two absences that mean "the host wired none". */
function buyerFacts(defaults: {
  buyer?: CheckoutContext["buyer"];
  taxIdOnFile?: boolean;
}): Pick<CheckoutContext, "buyer" | "taxIdOnFile"> {
  return {
    buyer: defaults.buyer ?? {},
    taxIdOnFile: defaults.taxIdOnFile ?? false,
  };
}

/** What the ENGINE knows and the base does not. */
interface CheckoutEngineState {
  buyer: CheckoutContext["buyer"];
  method: string | null;
  order: CheckoutOrder | null;
  outcome: CheckoutContext["outcome"];
  slices: Readonly<Record<string, unknown>>;
}

/**
 * The base context with the engine's own state laid over it.
 *
 * The BUYER is overlaid rather than merged: the shopper may have typed a CPF
 * for this purchase over the one on file, and the whole of `checkout-skip-dados`
 * turns on that replacement being visible to every later step.
 */
export function withCheckoutState(
  base: CheckoutContext,
  state: CheckoutEngineState,
): CheckoutContext {
  return {
    ...base,
    buyer: state.buyer,
    method: state.method,
    // The just-raised order wins over whatever the server or the park offered:
    // it is the one this visit is actually paying.
    order: state.order ?? base.order,
    outcome: state.outcome,
    slices: state.slices,
  };
}
