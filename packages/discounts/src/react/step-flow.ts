import type { StepCardState } from "@12-apps/ui/data-display/StepCardList";

import { fill, type CompleteDiscountsWebCopy } from "./copy";
import { STEPS, type StepNumber } from "./step-keys";

/**
 * Where the operator is in the four steps (FUT-4477, Story "Flow"), as a value
 * and the pure moves on it — the prototype's `next`, `go`, Tipo pick,
 * `toggleAll` and `goIssue`, one function each so each is a unit-tested rule.
 *
 * `cur` is the open step (0: none, everything collapsed); `reached` the
 * furthest step passed; `tried` the steps whose field messages show; `all` is
 * "Ver tudo numa página".
 */
export interface StepFlow {
  cur: StepNumber | 0;
  reached: 0 | StepNumber;
  tried: readonly StepNumber[];
  all: boolean;
}

/** Creating opens step 1; editing opens with every step done. */
export function initialFlow(editing: boolean): StepFlow {
  return editing ? { cur: 0, reached: 4, tried: [], all: false } : { cur: 1, reached: 0, tried: [], all: false };
}

function withTried(tried: readonly StepNumber[], steps: readonly StepNumber[]): StepNumber[] {
  return STEPS.filter((step) => tried.includes(step) || steps.includes(step));
}

function after(reached: 0 | StepNumber): StepNumber | 0 {
  return reached >= 4 ? 0 : ((reached + 1) as StepNumber);
}

/**
 * Continuar / Pronto on step n, once n has no errors (the button is disabled
 * otherwise): n is tried, `reached` moves to n if further, and the step after
 * `reached` opens — step 4 always opens after step 3, and passing step 4
 * collapses every card.
 */
export function flowNext(flow: StepFlow, step: StepNumber): StepFlow {
  const reached = Math.max(flow.reached, step) as StepNumber;
  return { ...flow, tried: withTried(flow.tried, [step]), reached, cur: after(reached) };
}

/** Alterar: that step opens; the others keep their state. */
export function flowOpen(flow: StepFlow, step: StepNumber): StepFlow {
  return { ...flow, cur: step };
}

/** Any change of Tipo: steps 2–4 ask a different question now. */
export function flowKindChanged(flow: StepFlow): StepFlow {
  return { ...flow, reached: Math.min(flow.reached, 1) as 0 | 1, tried: [] };
}

/** "Ver tudo numa página" and back: back returns to the step after `reached`. */
export function flowToggleAll(flow: StepFlow): StepFlow {
  return flow.all ? { ...flow, all: false, cur: after(flow.reached) } : { ...flow, all: true };
}

/**
 * A pendência, or the server attributing a refusal: leave Ver tudo, mark the
 * steps tried, and open the first of them.
 */
export function flowOpenTried(flow: StepFlow, steps: readonly StepNumber[]): StepFlow {
  const first = STEPS.find((step) => steps.includes(step));
  if (first === undefined) return flow;
  return { ...flow, all: false, tried: withTried(flow.tried, steps), cur: first };
}

/**
 * A submit the client or the server refused: every step at fault is tried, so
 * its messages show; outside Ver tudo the first of them opens (in Ver tudo every
 * step is open already).
 */
export function flowRefused(flow: StepFlow, steps: readonly StepNumber[]): StepFlow {
  const first = STEPS.find((step) => steps.includes(step));
  if (first === undefined) return flow;
  return { ...flow, tried: withTried(flow.tried, steps), cur: flow.all ? flow.cur : first };
}

/** What the card shows: open, answered (wrong or not), or still ahead. */
export function stepStateOf(flow: StepFlow, step: StepNumber, hasErrors: boolean): StepCardState {
  if (flow.all || flow.cur === step) return "current";
  if (step <= flow.reached) return hasErrors ? "error" : "done";
  return "todo";
}

/** The pendências count a step reached or tried; editing and Ver tudo count every step. */
export function countsStep(flow: StepFlow, editing: boolean, step: StepNumber): boolean {
  return editing || flow.all || step <= flow.reached || flow.tried.includes(step);
}

/**
 * Why the submit is held, the first matching reason winning, or null when it
 * may be pressed: so the only refusal after a press is the server's.
 */
export function submitHold(
  input: { flow: StepFlow; editing: boolean; issues: number; dirty: boolean },
  copy: CompleteDiscountsWebCopy,
): string | null {
  const { flow, editing, issues, dirty } = input;
  const { steps } = copy;
  if (!editing && flow.reached < 4 && !flow.all) return fill(steps.submitUnreached, { step: flow.reached + 1 });
  if (issues > 0) return editing ? steps.submitIssuesEdit : steps.submitIssuesCreate;
  if (editing && !dirty) return steps.submitUnchanged;
  return null;
}
