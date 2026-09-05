/**
 * WHERE A SERVER REFUSAL IS RE-RENDERED (FUT-1240).
 *
 * Every refusal the checkout POST can answer with carries a machine `code`.
 * A code belongs to whichever plugin can do something about it: the step that
 * owns the field, or the gate that owns the fact. `DELIVERY_ADDRESS_REQUIRED`
 * is the address step's; `STORE_CLOSED` is the open-store gate's. Routed that
 * way, the shopper meets the form or the curtain that can actually change the
 * answer.
 *
 * What this replaces is a single generic retry. A refusal rendered as "não foi
 * possível, tente novamente" beside a button that re-sends the same request is
 * a loop with no exit — the shopper presses it, the server refuses for the same
 * reason, and nothing on the screen names the reason or offers the remedy.
 *
 * ## A code nobody claimed is still shown
 *
 * The fallback is deliberate and is the reason a host can adopt this
 * incrementally: an unclaimed code renders on the CURRENT step as today's
 * refusal. A host that wants the compile-time guarantee declares its own
 * exhaustive owner map (`REFUSAL_OWNERS satisfies Record<Code, …>`); the
 * package keeps the runtime answer for every host that has not.
 */
import type { CheckoutError } from "../../components/checkout/types";

import type { AnyCheckoutGate, AnyCheckoutStep } from "./types";

/** Who answers a refusal code. */
export type RefusalOwner =
  | { kind: "step"; id: string }
  | { kind: "gate"; id: string }
  | { kind: "retry" };

/** Nothing claimed it — the current step shows it, exactly as today. */
const RETRY: RefusalOwner = { kind: "retry" };

/**
 * The plugin whose `answersCodes` names this code.
 *
 * STEPS are asked first. A gate and a step can both legitimately claim a code
 * — a delivery gate that refuses an unserviceable address and an address step
 * that owns the field — and when they do, the one the shopper can TYPE INTO is
 * the more useful screen.
 */
export function refusalOwner(
  code: string | null | undefined,
  steps: readonly AnyCheckoutStep[],
  gates: readonly AnyCheckoutGate[],
): RefusalOwner {
  if (!code) return RETRY;
  const step = steps.find((entry) => entry.answersCodes?.includes(code));
  if (step) return { kind: "step", id: step.id };
  const gate = gates.find((entry) => entry.answersCodes?.includes(code));
  if (gate) return { kind: "gate", id: gate.id };
  return RETRY;
}

/**
 * The error THIS step should render, or `null`.
 *
 * A claimed refusal reaches its claimant and nobody else, so a step never
 * renders a complaint about a field it does not draw. An unclaimed one reaches
 * whichever step the shopper is on.
 */
export function errorForStep(
  error: CheckoutError | null,
  owner: RefusalOwner,
  stepId: string,
  currentStepId: string | null,
): CheckoutError | null {
  if (!error) return null;
  if (owner.kind === "step") return owner.id === stepId ? error : null;
  if (owner.kind === "gate") return null;
  return stepId === currentStepId ? error : null;
}

/**
 * A refusal claimed by a STEP re-opens that step, whichever one the shopper
 * was on. That is the whole of "re-rendered THERE": the answer moves the
 * shopper to the screen that can change it, rather than describing it where
 * they happen to be standing.
 */
export function refusalStepOverride(
  error: CheckoutError | null,
  owner: RefusalOwner,
): string | null {
  if (!error || owner.kind !== "step") return null;
  return owner.id;
}
