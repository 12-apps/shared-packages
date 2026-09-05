/**
 * THE PAY PHASE (FUT-1240): the Pix code, the card form, the hand-off, and the
 * return from one.
 *
 * Every step here is `phase: "pay"` except the resume, and that matters: the
 * engine drops the whole phase for a settlement method whose `raisesCharge` is
 * `false`. So a shopper paying the courier never reaches any of these, and no
 * lane has to remember not to render them.
 *
 * The resume is `before-pay` rather than `pay` deliberately. A shopper coming
 * back from a provider's own page has to be resolved BEFORE they are offered a
 * way to pay again — and the same screen has to work for an in-person method,
 * which has no pay phase at all.
 */
import { Box } from "@mui/material";
import { useEffect, type JSX } from "react";

import { useCheckoutComponents } from "../../../components/checkout/ui";
import { useHostedResume, type HostedResume } from "../../../components/checkout/use-hosted-resume";
import type { FlowsRuntime } from "../../runtime";
import { usePipelineActions } from "../actions";
import { CARD_PANE_STEP, PIX_PANE_STEP } from "../methods";
import type { CheckoutStep, CheckoutStepRender } from "../types";

export const HANDOFF_STEP_ID = "handoff";
export const RESUME_STEP_ID = "resume";

/** A raised order whose provider takes the money on its own page. */
function handedOver(url: string | undefined): url is string {
  return typeof url === "string" && url.length > 0;
}

function PixView({ ctx }: CheckoutStepRender<void>): JSX.Element | null {
  const actions = usePipelineActions();
  const PixPayment = actions.screens.PixPayment;
  if (!ctx.order) return null;
  return <PixPayment payable={ctx.order} onResolved={actions.resolve} />;
}

function CardView({ ctx }: CheckoutStepRender<void>): JSX.Element | null {
  const actions = usePipelineActions();
  const CardEntry = actions.screens.CardEntry;
  if (!ctx.order) return null;
  return <CardEntry payable={ctx.order} onResolved={actions.resolve} />;
}

/**
 * The Pix code, once one exists.
 *
 * WHICH method this pane belongs to is not asked here: the engine reads it off
 * the descriptor that named this step as its `pane`, so a method the package
 * has never heard of can reuse the pane by naming it, and no pane states its
 * own method twice.
 */
export const pixStep: CheckoutStep = {
  id: PIX_PANE_STEP,
  phase: "pay",
  order: 0,
  applies(ctx) {
    return ctx.order !== null && !handedOver(ctx.order.hostedCheckoutUrl);
  },
  complete(ctx) {
    return ctx.outcome !== null;
  },
  render(props) {
    return <PixView {...props} />;
  },
};

/** The card form, once an order exists to charge. Its method is its `pane` owner. */
export const cardStep: CheckoutStep = {
  id: CARD_PANE_STEP,
  phase: "pay",
  order: 1,
  applies(ctx) {
    return ctx.order !== null && !handedOver(ctx.order.hostedCheckoutUrl);
  },
  complete(ctx) {
    return ctx.outcome !== null;
  },
  render(props) {
    return <CardView {...props} />;
  },
};

/**
 * The hand-off interstitial: the order is parked and the tab is leaving.
 *
 * `complete` is `false` forever on purpose — there is no next step on THIS
 * page. What comes back is a fresh mount that meets the resume step.
 */
function HandoffView({ ctx, back }: CheckoutStepRender<void>): JSX.Element | null {
  const { Text } = useCheckoutComponents();
  const actions = usePipelineActions();
  const HostedHandoff = actions.screens.HostedHandoff;
  const url = ctx.order?.hostedCheckoutUrl;
  if (!ctx.order || !handedOver(url)) return null;
  const pipeline = actions.copy.pipeline;
  const waiting =
    (ctx.method === null ? undefined : pipeline.awaitingHandover[ctx.method]) ?? pipeline.loading;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Text variant="body" size="sm" color="secondary" as="p" data-testid="checkout-awaiting-handover">
        {waiting}
      </Text>
      <HostedHandoff url={url} payable={ctx.order} onCancel={back} />
    </Box>
  );
}

export const handoffStep: CheckoutStep = {
  id: HANDOFF_STEP_ID,
  phase: "pay",
  order: 2,
  applies(ctx) {
    return ctx.order !== null && handedOver(ctx.order.hostedCheckoutUrl);
  },
  complete() {
    return false;
  },
  render(props) {
    return <HandoffView {...props} />;
  },
};

/**
 * A shopper coming back from a provider's own page.
 *
 * It runs the package's OWN resume machinery — `useHostedResume`, with this
 * checkout's slug and basket — rather than a second reading of the parked
 * entry. That matters more than the extra hook: `useHostedResume` carries the
 * whole FUT-1213 rule, including the deferral until the cart has answered, the
 * bounded wait when it never does, and the one server ASK for a basket that
 * has changed. A step that re-implemented "is something parked?" would be a
 * second answer to a question with one correct one, on the money path.
 *
 * WHERE a resume lands is `hosted-return.ts`'s decision, honoured here:
 *
 *  - a HAND-OFF has nothing left on our page, so it waits on the confirmation
 *    until the poll reaches a terminal state;
 *  - anything else — a Pix code, a card charge raised on our own page — is
 *    ADOPTED as this visit's order, and the walk puts the shopper back in
 *    front of the pane that still has what they need.
 */
export function buildResumeStep(runtime: FlowsRuntime): CheckoutStep<void, HostedResume> {
  return {
    id: RESUME_STEP_ID,
    phase: "before-pay",
    order: -10,
    useFacts() {
      const tenantSlug = runtime.useTenantSlug();
      const cart = runtime.config.useCart();
      return useHostedResume(tenantSlug, cart.identity);
    },
    applies(ctx, resume) {
      return ctx.outcome === null && ctx.order === null && resume.order !== null;
    },
    complete(ctx) {
      return ctx.outcome !== null || ctx.order !== null;
    },
    render({ facts }) {
      return <ResumeView resume={facts} />;
    },
  };
}

/** The resumed order, taken up by whichever half of the walk owns it. */
function ResumeView({ resume }: { resume: HostedResume }): JSX.Element | null {
  const actions = usePipelineActions();
  const { adoptOrder, resolve } = actions;
  const { order, step, status } = resume;
  useEffect(() => {
    if (!order) return;
    // An on-page charge belongs to the WALK, not to this screen: adopting it
    // makes the pane apply on the very next render.
    if (step === "payment") adoptOrder(order);
    else if (status !== null && status !== "AWAITING_PAYMENT") resolve(status);
  }, [order, step, status, adoptOrder, resolve]);
  if (!order || step === "payment") return null;
  const PaymentStatus = actions.screens.PaymentStatus;
  return <PaymentStatus status={status} payable={order} />;
}
