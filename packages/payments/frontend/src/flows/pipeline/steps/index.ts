/**
 * The SEVEN screens this package already shipped, wrapped as steps (FUT-1240).
 *
 * Buyer details, the method picker, the Pix pane, the card pane, the hand-off
 * interstitial, the return from one, and the confirmation. Each wrapper is
 * thin by design: the behaviour stays in `components/checkout/*` and in the
 * screens `flows/screens-*.tsx` already binds, and what is added here is only
 * WHERE each one sits in a walk that is derived rather than switched on.
 *
 * The RETURN step is the one that is not a bare wrapper, and the reason is
 * worth stating: `screens.HostedReturn` owns its own read of the parked entry,
 * which is right for a host mounting it at a dedicated return route and wrong
 * inside a checkout that already knows the slug and the basket. So the step
 * runs `useHostedResume` — the package's own FUT-1213 rule, deferral and
 * server ASK included — and renders the confirmation while it waits.
 */
import type { FlowsRuntime } from "../../runtime";
import type { AnyCheckoutStep, AnySettlementMethod } from "../types";

import { buildMethodStep, dadosStep } from "./buyer-steps";
import { buildResumeStep, cardStep, handoffStep, pixStep } from "./pay-steps";
import { statusStep } from "./status-step";

export {
  BUYER_FIELD_CODE,
  DADOS_STEP_ID,
  METHOD_STEP_ID,
  dadosSliceOf,
  methodSliceOf,
} from "./buyer-steps";
export { HANDOFF_STEP_ID, RESUME_STEP_ID } from "./pay-steps";
export { STATUS_STEP_ID } from "./status-step";

/**
 * The package's own steps, built once per factory.
 *
 * The returned array is a factory-scope constant — never rebuilt — because
 * every registered plugin's `useFacts()` runs in array order and React's hook
 * identity is positional. See `stable-plugins.ts`.
 */
export function packageSteps(
  runtime: FlowsRuntime,
  methods: readonly AnySettlementMethod[],
): readonly AnyCheckoutStep[] {
  return Object.freeze([
    buildResumeStep(runtime),
    dadosStep,
    buildMethodStep(methods),
    pixStep,
    cardStep,
    handoffStep,
    statusStep,
  ]);
}
