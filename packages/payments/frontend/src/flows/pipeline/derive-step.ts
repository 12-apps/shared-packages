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
 * `checkout-actions.ts`'s nav has three rules that look like details and are
 * not, because the money path walks through them:
 *
 *  - back off the payment step lands on Dados — UNLESS the buyer has a CPF on
 *    file and has never opened Dados, in which case that step is not part of
 *    their flow and the only honest destination is the catalog;
 *  - "alterar" (`editBuyer`) exists ONLY for a buyer whose Dados was skipped,
 *    and opening it makes Dados part of their flow from then on;
 *  - back off the CONFIRMATION is the catalog, always. The flat nav maps back
 *    to Dados only from `payment`; every other step goes to the menu.
 *
 * The first two fall out of one general rule here: **back re-opens the PREVIOUS
 * APPLYING step, and exits when there is none.** A skipped Dados does not
 * apply, so it is not the previous applying step, so back exits — which is the
 * second rule verbatim. `editBuyer` flips the Dados slice's `opened`, after
 * which Dados applies and back returns to it — which is the first.
 *
 * The third does NOT, and stating it separately is the whole of {@link
 * deriveNav}'s `terminal`. A paid Pix order leaves its pane APPLYING — an order
 * exists, nothing handed over — and merely COMPLETE, so the previous applying
 * step behind the confirmation is the payment surface for money that already
 * moved. Re-opening it puts a live pay button in front of a shopper who has
 * paid, which is the hazard `ADOPTING.md` records under one owner paying four
 * times.
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

/**
 * THE PANE RULE, stated once — the other half of the no-charge one.
 *
 * A `pay`-phase step that some registered method named as its
 * {@link AnySettlementMethod.pane} belongs to THAT method: it applies while
 * that method is the chosen one and never otherwise. A `pay` step nobody named
 * — the hand-off interstitial, which is about the ORDER rather than about the
 * method — is untouched by this.
 *
 * Stated here rather than as a `ctx.method === "PIX"` inside each pane, because
 * a descriptor field that decides nothing is config that lies: `pane` was
 * declared, documented and read nowhere while the two panes hard-coded the very
 * ids it names.
 */
function paneApplies(
  step: AnyCheckoutStep,
  ctx: CheckoutContext,
  methods: readonly AnySettlementMethod[],
): boolean {
  if (!methods.some((entry) => entry.pane === step.id)) return true;
  const chosen = methods.find((entry) => entry.id === ctx.method);
  return chosen?.pane === step.id;
}

/** The steps that apply to this shopper, with the no-charge rule already applied. */
export function applyingSteps(input: DeriveStepInput): AnyCheckoutStep[] {
  const { ctx, facts, methods } = input;
  const charges = raisesCharge(ctx.method, methods);
  return orderedSteps(input.steps).filter((step) => {
    if (step.phase === "pay") {
      if (!charges) return false;
      if (!paneApplies(step, ctx, methods)) return false;
    }
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
 *
 * `terminal` is `ctx.outcome !== null`, and it is the flat nav's "from `status`
 * you go to the menu" — see the third rule at the top of this file. It is asked
 * of the OUTCOME rather than of the last step's identity so that a host's own
 * confirmation, and a FAILED or EXPIRED one, answer the same way: once this
 * checkout has an outcome there is nothing behind it a shopper should be sent
 * back into.
 */
export function deriveNav(input: {
  applying: readonly AnyCheckoutStep[];
  index: number;
  taxIdOnFile: boolean;
  /** The walk has an outcome — `ctx.outcome !== null`. */
  terminal: boolean;
  ports: NavPorts;
}): { back(): void; editBuyer: (() => void) | undefined } {
  const { applying, index, ports } = input;
  const previous = input.terminal || index <= 0 ? undefined : applying[index - 1];
  return {
    back() {
      if (previous) ports.reopen(previous.id);
      else ports.exitToCatalog();
    },
    editBuyer: input.taxIdOnFile ? ports.openDados : undefined,
  };
}
