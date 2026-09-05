/**
 * MAY THIS SHOPPER CHECK OUT — one answer, offered headless (FUT-1240).
 *
 * The gates run in ARRAY ORDER and the first non-`pass` verdict wins. Order
 * matters and is the host's to choose: a gate that would curtain the screen
 * must not speak before the gate that is still waiting for the cart, or a
 * shopper meets "loja fechada" because a fact had not arrived yet.
 *
 * Exported as `flows.useAdmission()` so the cart drawer's CTA and a
 * buy-now button consume the SAME list the checkout does. Two surfaces
 * deciding this separately is how a storefront ends up with a drawer that
 * offers a checkout the checkout itself refuses.
 */
import { hostedCheckoutReturnPending } from "../../components/checkout/hosted-return";

import type { AnyCheckoutGate, CheckoutContext, GateVerdict } from "./types";

/** Nothing said otherwise. */
const PASS: GateVerdict = { kind: "pass" };

/**
 * The gates' verdict, given the facts each of them returned.
 *
 * Pure: the hooks run in the caller's body, in array order, and their answers
 * arrive here as a list. That is what makes this testable without a renderer
 * and what keeps hook order a property of the ARRAY rather than of the
 * verdicts.
 */
export function decideAdmission(input: {
  gates: readonly AnyCheckoutGate[];
  facts: readonly unknown[];
  ctx: CheckoutContext;
  /** A hand-off from this tab is still waiting — see `standsAsideForResume`. */
  resuming: boolean;
}): GateVerdict {
  for (const [at, gate] of input.gates.entries()) {
    // A gate that stands aside for a resume is standing aside from the one
    // route where money gets confirmed. Skipped for that visit only.
    if (input.resuming && gate.standsAsideForResume) continue;
    const verdict = gate.decide(input.ctx, input.facts[at]);
    if (verdict.kind !== "pass") return verdict;
  }
  return PASS;
}

/**
 * Whether a hand-off from this tab is still waiting to be resolved.
 *
 * Asked with the SAME slug and basket the resume asks with, so a gate and the
 * flow behind it cannot disagree about whose return this is — the property
 * `hostedCheckoutReturnPending`'s own doc argues for at length.
 */
export function resumePending(ctx: CheckoutContext): boolean {
  return hostedCheckoutReturnPending(ctx.tenantSlug, ctx.cart.identity);
}
