/**
 * THE CONFIRMATION (FUT-1240) — the one step every settlement reaches.
 *
 * `complete` is `false` forever: a walk whose last step is finished has
 * nowhere to put the shopper, and this is where a checkout ends. The
 * registered method may replace the screen entirely (`Confirmation` on its
 * descriptor), which is how a settlement that raises no charge says
 * "recebemos seu pedido" instead of "pagamento aprovado" without the engine
 * knowing either sentence.
 */
import type { JSX } from "react";

import { descriptorFor, usePipelineActions } from "../actions";
import type { CheckoutStep, CheckoutStepRender } from "../types";

export const STATUS_STEP_ID = "status";

function StatusView({ ctx }: CheckoutStepRender<void>): JSX.Element {
  const actions = usePipelineActions();
  const descriptor = descriptorFor(actions.methods, ctx);
  const Confirmation = descriptor?.Confirmation;
  if (Confirmation && ctx.order) return <Confirmation ctx={ctx} order={ctx.order} />;
  const PaymentStatus = actions.screens.PaymentStatus;
  return <PaymentStatus status={ctx.outcome} payable={ctx.order} />;
}

export const statusStep: CheckoutStep = {
  id: STATUS_STEP_ID,
  phase: "after-pay",
  order: 0,
  label: "status",
  applies(ctx) {
    return ctx.outcome !== null;
  },
  complete() {
    return false;
  },
  render(props) {
    return <StatusView {...props} />;
  },
};
