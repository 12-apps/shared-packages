/**
 * THE CHECKOUT PIPELINE'S VOCABULARY (FUT-1240, step 4 of FUT-1216).
 *
 * A checkout is a list of STEPS, a list of GATES and a list of SETTLEMENT
 * METHODS. Each is a plain object in an array; registration is array
 * membership and nothing else. The engine derives which step the shopper is
 * on rather than remembering it, so a reload, a torn-down tab and a hand-off
 * return all land where the server's own facts say they should.
 *
 * ## Two properties this file exists to keep
 *
 * 1. **Method syntax, never arrow properties.** Under `strictFunctionTypes` a
 *    method's parameters are BIVARIANT while a property holding a function is
 *    contravariant — so `CheckoutStep<S, F>` is assignable to
 *    {@link AnyCheckoutStep} with no `any` and no cast. Written as
 *    `applies: (ctx, facts) => boolean` instead, every registration would need
 *    a cast, and this repo forbids `any`.
 * 2. **The package names no host.** Nothing here imports a host, a sibling
 *    workspace package or a domain word. A mode, a mesa, a comanda and a
 *    delivery address are all host concepts and reach the engine as a
 *    registered step or a registered method, never as a field.
 */
import type { ComponentType, ReactNode } from "react";

import type { CheckoutCartView } from "../../components/checkout/checkout-flow";
import type {
  BuyerInfo,
  CheckoutError,
  CheckoutOrder,
  CheckoutProviderConfig,
  CreateOrderRequest,
  OrderStatus,
  SettlementCheckout,
} from "../../components/checkout/types";
import type {
  CheckoutStepperCopy,
  CheckoutViewCopy,
} from "../../components/checkout/view-copy";

/**
 * Where a step sits in the walk. The engine sorts by this first and by
 * {@link CheckoutStep.order} second, so a host appends a step without knowing
 * what else is registered.
 *
 * `pay` is the phase the no-charge rule is stated over: a settlement method
 * that raises no charge mounts NO `pay` step, ever — see
 * {@link SettlementMethodDescriptor.raisesCharge}.
 */
export type CheckoutStepPhase = "details" | "before-pay" | "pay" | "after-pay";

/** Everything a step, a gate or a method may read. All of it server-owned or parked. */
export interface CheckoutContext {
  tenantSlug?: string;
  /** `GET /config`: chain, methods, tokenization. */
  config: CheckoutProviderConfig | null;
  configPending: boolean;
  cart: CheckoutCartView;
  /** Host-resolved balance, opaque scope. */
  settlement: SettlementCheckout | null;
  buyer: BuyerInfo;
  taxIdOnFile: boolean;
  /** A {@link SettlementMethodDescriptor.id}, or `null` before a choice. */
  method: string | null;
  /** Raised now, resumed from the server, or parked by a hand-off. */
  order: CheckoutOrder | null;
  outcome: OrderStatus | null;
  intent: { oneClick: boolean; resuming: boolean; presetMethod: string | null };
  /** Every step's declared slice, by step id. */
  slices: Readonly<Record<string, unknown>>;
}

/**
 * A step's own scrap of state, DECLARED rather than held.
 *
 * The engine owns the storage, which is what makes a reload survivable: a
 * `session` slice is parked under `payments.checkout.<slug>.<stepId>` and
 * rehydrated on mount. Nothing money-shaped belongs here — that is the order.
 */
export interface StepSlice<S> {
  initial(ctx: CheckoutContext): S;
  /** `"session"` ⇒ `payments.checkout.<slug>.<stepId>`, rehydrated on mount. */
  persist: "none" | "session";
  /**
   * Trust nothing that came back out of storage — the `hosted-return.ts` rule.
   * A `session` slice with NO parser is never rehydrated: the engine cannot
   * check a shape it has not been told, and a half-written value reaching a
   * step as its state is exactly what that rule exists to stop.
   */
  parse?(raw: unknown): S | null;
}

/** What a step's `render` is handed. Its own type so the method syntax stays readable. */
export interface CheckoutStepRender<S> {
  ctx: CheckoutContext;
  slice: S;
  setSlice(s: S): void;
  /** Done here — clear any back-navigation and let the walk move on. */
  advance(): void;
  /** The previous applying step, or the host's catalog when there is none. */
  back(): void;
  /** A server refusal THIS step claimed through {@link CheckoutStep.answersCodes}. */
  error: CheckoutError | null;
}

/** One step of the walk. */
export interface CheckoutStep<S = void, F = void> {
  id: string;
  phase: CheckoutStepPhase;
  order?: number;
  /** Host hook; runs EVERY render, in array order. */
  useFacts?(): F;
  /** Pure. */
  applies(ctx: CheckoutContext, facts: F): boolean;
  /** Pure — the current step is the first applying step whose answer is `false`. */
  complete(ctx: CheckoutContext, facts: F, slice: S): boolean;
  slice?: StepSlice<S>;
  render(p: CheckoutStepRender<S> & { facts: F }): ReactNode;
  /** Server refusal codes re-rendered HERE, never as a generic retry. */
  answersCodes?: readonly string[];
  contribute?(ctx: CheckoutContext, facts: F, slice: S): Partial<CreateOrderRequest>;
  /** Absent ⇒ an interstitial, not a stepper node. */
  label?: keyof CheckoutStepperCopy | null;
}

/** Any registered step. Reachable with no cast because every member above is a method. */
export type AnyCheckoutStep = CheckoutStep<unknown, unknown>;

/** What a gate decided about this shopper. */
export type GateVerdict =
  | { kind: "pass" }
  | { kind: "pending" }
  | {
      kind: "refuse";
      Screen: ComponentType<{
        ctx: CheckoutContext;
        error: CheckoutError | null;
        retry(): void;
      }>;
    };

/** Something that must be true before ANY step renders. */
export interface CheckoutGate<F = void> {
  id: string;
  useFacts?(): F;
  /** Pure. */
  decide(ctx: CheckoutContext, facts: F): GateVerdict;
  answersCodes?: readonly string[];
  /** Bypassed when a hand-off from this tab is still waiting to be resolved. */
  standsAsideForResume?: boolean;
}

/** Any registered gate. */
export type AnyCheckoutGate = CheckoutGate<unknown>;

/**
 * A way of settling — the seam a no-charge settlement never had.
 *
 * `raisesCharge: false` is the whole reason this type exists: placing the
 * order IS the settlement, so there is no `/charge`, no poll, and no payment
 * surface after the method is chosen. The engine enforces that ONCE, over the
 * `pay` phase, so no lane can forget it.
 */
export interface SettlementMethodDescriptor<F = void> {
  /** `"PIX"`, `"CARD"`, `"ON_DELIVERY"`, `"WAITER"`, `"BOLETO"`… */
  id: string;
  /** `false` ⇒ no `/charge`, no poll; placing the order IS the settlement. */
  raisesCharge: boolean;
  /** The `pay`-phase step id shown once the order exists; `null` ⇒ Confirmation. */
  pane: string | null;
  useFacts?(): F;
  offered(ctx: CheckoutContext, facts: F): boolean;
  Review?: ComponentType<{
    ctx: CheckoutContext;
    place(): void;
    placing: boolean;
    error: CheckoutError | null;
  }>;
  /** Default: the package's own `PaymentStatus`. */
  Confirmation?: ComponentType<{ ctx: CheckoutContext; order: CheckoutOrder }>;
  tile(copy: CheckoutViewCopy): { label: string; hint?: string };
}

/** Any registered settlement method. */
export type AnySettlementMethod = SettlementMethodDescriptor<unknown>;

/**
 * Where the shopper leaves for, and how.
 *
 * A hook for the label because it is the host's router that knows which
 * catalog this checkout came from, and a value would freeze the first one.
 */
export interface CheckoutExit {
  useCatalog(): { to: string; label: string };
  navigate(to: string): void;
}

/**
 * The engine's half of `PaymentFlowsConfig` — every key OPTIONAL.
 *
 * Setting ANY of them switches `Checkout` onto the pipeline. Setting NONE
 * leaves it rendering exactly today's `CheckoutFlow`, which is the whole
 * meaning of this step being additive.
 */
export interface CheckoutPipelineConfig {
  /** Merged with the package's own, by phase then `order`. */
  steps?: readonly AnyCheckoutStep[];
  /** Evaluated in order before any step renders. */
  gates?: readonly AnyCheckoutGate[];
  /** Merged with the package's PIX + CARD. */
  settlementMethods?: readonly AnySettlementMethod[];
  /** The HOST reads its own URL; the package reads nothing. */
  useIntent?(): CheckoutContext["intent"];
  /** Resume from the SERVER, not only from a parked hand-off. */
  useOpenPayable?(): { order: CheckoutOrder | null; pending: boolean };
  /** Absent ⇒ `ports.exitToCatalog()`, which is what every host wires today. */
  exit?: CheckoutExit;
  /** The host invalidates ITS keys. */
  onSettled?(outcome: OrderStatus, order: CheckoutOrder): void;
}

/** Whether a config asked for the pipeline at all. */
export function pipelineRequested(config: CheckoutPipelineConfig): boolean {
  return (
    config.steps !== undefined ||
    config.gates !== undefined ||
    config.settlementMethods !== undefined ||
    config.useIntent !== undefined ||
    config.useOpenPayable !== undefined ||
    config.exit !== undefined ||
    config.onSettled !== undefined
  );
}
