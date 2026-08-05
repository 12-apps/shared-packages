/**
 * Checkout failure codes the BUYER SURFACE presents differently (FUT-563).
 *
 * Everything else the server refuses is one thing to a shopper — "it did not
 * work, try again" — and one danger Alert says it. These are the exceptions:
 * codes whose correct rendering is not an error at all, and which a message
 * string cannot be parsed for without turning copy edits into behaviour
 * changes.
 */

/**
 * The charge is IN DOUBT, not failed: some provider may be holding the buyer's
 * money and no probe could say. It is the one outcome where inviting a retry
 * is actively harmful, so the surface must drop every affordance that offers
 * one and must not word it as a failure.
 */
export const UNRESOLVED_CODE = "PAYMENT_UNRESOLVED";
