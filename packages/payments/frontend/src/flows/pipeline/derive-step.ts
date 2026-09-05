/**
 * WHICH STEP THE SHOPPER IS ON — derived, never remembered (FUT-1240).
 *
 * The flat controller holds `useState<Step>`, so a reload, a discarded tab or
 * a return from a provider's own page all forget where the shopper was. Here
 * the answer is a function of facts the SERVER owns (the cart, the buyer's
 * `hasTaxId`, the open payable) plus the steps' own declared slices, so it is
 * the same answer before and after the page goes away.
 *
 * ## It reproduces `useCheckoutNav` exactly, and that is the point
 *
 * `checkout-actions.ts`'s nav has two rules that look like details and are
 * not, because the money path walks through them:
 *
 *  - back off the payment step lands on Dados — UNLESS the buyer has a CPF on
 *    file and has never opened Dados, in which case that step is not part of
 *    their flow and the only honest destination is the catalog;
 *  - "alterar" (`editBuyer`) exists ONLY for a buyer whose Dados was skipped,
 *    and opening it makes Dados part of their flow from then on.
 *
 * Both fall out of one general rule here: **back re-opens the PREVIOUS APPLYING
 * step, and exits when there is none.** A skipped Dados does not apply, so it
 * is not the previous applying step, so back exits — which is the second rule
 * verbatim. `editBuyer` flips the Dados slice's `opened`, after which Dados
 * applies and back returns to it — which is the first.
 */
import type {
  AnyCheckoutStep,
  AnySettlementMethod,
  CheckoutContext,
  CheckoutStepPhase,
} from "./types";

/** Phases in walk order. A step's `order` breaks ties inside one phase. */
const PHASE_ORDER: readonly CheckoutStepPhase[] = [
  "details",
  "before-pay",
  "pay",
  "after-pay",
];

/** Facts, by step id — the engine runs every `useFacts()` once, in array order. */
type StepFacts = Readonly<Record<string, unknown>>;

/** What a walk over the registered steps produced. */
interface DerivedStep {
  /** The step to render, or `null` when nothing applies yet. */
  step: AnyCheckoutStep | null;
  /** Every step that applies to THIS shopper, in walk order. */
  applying: readonly AnyCheckoutStep[];
  /** `step`'s index in {@link applying}, or `-1`. */
  index: number;
}

/**
 * The registered steps in walk order.
 *
 * Sorted stably: two steps in the same phase with the same `order` keep the
 * order their arrays were merged in, so a host appending a step never reshuffles
 * the package's own.
 */
function orderedSteps(steps: readonly AnyCheckoutStep[]): AnyCheckoutStep[] {
  return steps
    .map((step, at) => ({ step, at }))
    .sort((left, right) => {
      const phase =
        PHASE_ORDER.indexOf(left.step.phase) - PHASE_ORDER.indexOf(right.step.phase);
      if (phase !== 0) return phase;
      const order = (left.step.order ?? 0) - (right.step.order ?? 0);
      return order !== 0 ? order : left.at - right.at;
    })
    .map((entry) => entry.step);
}

/**
 * THE NO-CHARGE RULE, stated once.
 *
 * A settlement method whose `raisesCharge` is `false` mounts no payment
 * surface after it is chosen: no Dados-for-the-charge, no method pane, no
 * poll. Enforced here rather than in each lane, because "each lane" is exactly
 * how a delivery checkout ended up rendering a PIX pane for a shopper paying
 * the courier.
 *
 * Unknown method ⇒ the rule does not fire. An id nobody registered cannot be
 * asserted to raise no charge, and refusing the pay phase on a guess would
 * strand a shopper mid-payment.
 */
export function raisesCharge(
  method: string | null,
  methods: readonly AnySettlementMethod[],
): boolean {
  if (method === null) return true;
  const descriptor = methods.find((entry) => entry.id === method);
  return descriptor ? descriptor.raisesCharge : true;
}

/**
 * A step's slice, with the step's own `initial` standing in when the context
 * carries none.
 *
 * The engine seeds every slice at mount, so in a live checkout this fallback
 * never fires. It exists because `complete()` is a step author's function and
 * must never be handed `undefined` where its type says `S` — a walk that
 * throws while deciding where the shopper is would take the whole checkout
 * with it, and the cause would be an absent key.
 */
export function sliceFor(step: AnyCheckoutStep, ctx: CheckoutContext): unknown {
  const value = ctx.slices[step.id];
  if (value !== undefined) return value;
  return step.slice ? step.slice.initial(ctx) : undefined;
}

/** What `deriveStep` is asked. */
interface DeriveStepInput {
  steps: readonly AnyCheckoutStep[];
  ctx: CheckoutContext;
  facts: StepFacts;
  methods: readonly AnySettlementMethod[];
  /** A step the shopper navigated BACK to; it wins while it still applies. */
  reopened?: string | null;
}

/** The steps that apply to this shopper, with the no-charge rule already applied. */
export function applyingSteps(input: DeriveStepInput): AnyCheckoutStep[] {
  const { ctx, facts, methods } = input;
  const charges = raisesCharge(ctx.method, methods);
  return orderedSteps(input.steps).filter((step) => {
    if (!charges && step.phase === "pay") return false;
    return step.applies(ctx, facts[step.id]);
  });
}

/**
 * The current step: the first applying step whose `complete()` is false, plus
 * the one explicit override — a step the shopper pressed back into.
 *
 * All complete ⇒ the LAST applying step, which is the terminal one. The
 * package's own confirmation answers `complete: false` forever, so this is a
 * safety net rather than a path: a walk whose every step is finished has
 * nowhere else to put the shopper.
 */
export function deriveStep(input: DeriveStepInput): DerivedStep {
  const applying = applyingSteps(input);
  const reopened = input.reopened ?? null;
  const back = reopened === null ? -1 : applying.findIndex((step) => step.id === reopened);
  if (back !== -1) return { step: applying[back] ?? null, applying, index: back };
  const at = applying.findIndex(
    (step) => !step.complete(input.ctx, input.facts[step.id], sliceFor(step, input.ctx)),
  );
  if (at !== -1) return { step: applying[at] ?? null, applying, index: at };
  const last = applying.length - 1;
  return { step: applying[last] ?? null, applying, index: last };
}

/** The ports `deriveNav` drives — the engine's own writers, named. */
interface NavPorts {
  /** Mark a step as the one the shopper went back to. */
  reopen(stepId: string): void;
  /** Open the buyer-details step for a shopper whose CPF made it skippable. */
  openDados(): void;
  /** Leave checkout for the host's catalog. */
  exitToCatalog(): void;
}

/**
 * `back` and `editBuyer`, reproducing `useCheckoutNav` (FUT-465, FUT-1216
 * risk 2).
 *
 * `editBuyer` is `undefined` unless Dados was SKIPPED — the payer block keys
 * off its presence, so the decision lives here rather than being re-derived by
 * every caller, exactly as it did in the flat controller.
 */
export function deriveNav(input: {
  applying: readonly AnyCheckoutStep[];
  index: number;
  taxIdOnFile: boolean;
  ports: NavPorts;
}): { back(): void; editBuyer: (() => void) | undefined } {
  const { applying, index, ports } = input;
  const previous = index > 0 ? applying[index - 1] : undefined;
  return {
    back() {
      if (previous) ports.reopen(previous.id);
      else ports.exitToCatalog();
    },
    editBuyer: input.taxIdOnFile ? ports.openDados : undefined,
  };
}
