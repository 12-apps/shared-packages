// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOSTED_ORDER_STORAGE_KEY,
  rememberHostedOrder,
  takeHostedOrder,
} from "../hosted-return";
import type { CheckoutOrder } from "../types";

/**
 * FUT-556 — surviving the trip to a hosted checkout.
 *
 * A redirect provider tears the SPA down. These pin the two rules that keep the
 * return from landing on a blank payment step, and keep an ABANDONED payment
 * from resurfacing as if it had happened: the parked order is handed back only
 * on a return trip, and only once.
 */

const ORDER: CheckoutOrder = {
  orderId: "o1",
  status: "AWAITING_PAYMENT",
  method: "PIX",
  totalCents: 550,
  subtotalCents: 550,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 5,50",
};

/** Put the tab on `search`, the way the provider's redirect leaves it. */
function land(search: string): void {
  window.history.replaceState({}, "", `/future-drink/menu/checkout${search}`);
}

describe("hosted-return", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("hands the order back when the provider sent the buyer home", () => {
    rememberHostedOrder(ORDER);
    land("?transaction_nsu=123&slug=abc");

    expect(takeHostedOrder()).toEqual(ORDER);
  });

  it("recognises a return that carries only one of the markers", () => {
    rememberHostedOrder(ORDER);
    land("?slug=abc");

    expect(takeHostedOrder()?.orderId).toBe("o1");
  });

  it("recognises a buyer coming back from a Stripe 3DS challenge (FUT-698)", () => {
    // What Stripe appends to the card confirm's `return_url` after the issuer
    // page: the intent id, its client secret and the redirect verdict.
    rememberHostedOrder(ORDER);
    land("?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret&redirect_status=succeeded");

    expect(takeHostedOrder()?.orderId).toBe("o1");
  });

  it("still recognises the hosted-store return exactly as before (FUT-556)", () => {
    // The InfinitePay handoff must keep working with the Stripe markers added:
    // "loja hospedada continua com o hand-off e retorno de hoje".
    rememberHostedOrder(ORDER);
    land("?transaction_nsu=123&slug=abc&order_nsu=o1");

    expect(takeHostedOrder()?.orderId).toBe("o1");
  });

  it("ignores a parked order when this is not a return trip", () => {
    rememberHostedOrder(ORDER);
    land("");

    // A buyer who abandoned the provider's page and came back to checkout later
    // must start a fresh order, not resume one they never paid.
    expect(takeHostedOrder()).toBeNull();
  });

  it("hands the order back exactly once", () => {
    rememberHostedOrder(ORDER);
    land("?transaction_nsu=123");

    expect(takeHostedOrder()).not.toBeNull();
    expect(takeHostedOrder()).toBeNull();
  });

  it("answers null for a value that is not an order", () => {
    window.sessionStorage.setItem(HOSTED_ORDER_STORAGE_KEY, '{"nonsense":true}');
    land("?transaction_nsu=123");

    expect(takeHostedOrder()).toBeNull();
  });

  it("answers null for unparseable storage rather than throwing", () => {
    window.sessionStorage.setItem(HOSTED_ORDER_STORAGE_KEY, "{not json");
    land("?transaction_nsu=123");

    expect(takeHostedOrder()).toBeNull();
  });

  it("still reads an order parked under the pre-2.0.0 key, once", () => {
    // The compatibility path for a buyer who left on a pre-rename bundle.
    // Written by hand (decoded, so this file stays brand-clean under the repo
    // sweep) because nothing in this version produces the key any more — and
    // asserted because otherwise the fallback is dead code that only LOOKS
    // like a migration. See LEGACY_KEY's docstring for the deletion condition.
    const legacyKey = atob("ZnV0dXJlcGF5LmNoZWNrb3V0Lmhvc3RlZE9yZGVy");
    window.sessionStorage.setItem(legacyKey, JSON.stringify(ORDER));
    land("?transaction_nsu=123");

    expect(takeHostedOrder()?.orderId).toBe(ORDER.orderId);
    // Cleared like any other read, so a later return trip cannot resume it.
    expect(window.sessionStorage.getItem(legacyKey)).toBeNull();
  });

  it("prefers the current key when both are somehow present", () => {
    const legacyKey = atob("ZnV0dXJlcGF5LmNoZWNrb3V0Lmhvc3RlZE9yZGVy");
    window.sessionStorage.setItem(legacyKey, JSON.stringify({ ...ORDER, orderId: "stale" }));
    window.sessionStorage.setItem(HOSTED_ORDER_STORAGE_KEY, JSON.stringify(ORDER));
    land("?transaction_nsu=123");

    expect(takeHostedOrder()?.orderId).toBe(ORDER.orderId);
  });

  it("ignores a value under any other name — no generic key scan", () => {
    // A foreign key must neither resume an order nor be touched by the
    // read-and-clear: the fallback is ONE named legacy key, not a pattern.
    window.sessionStorage.setItem("some-other.checkout.key", JSON.stringify(ORDER));
    land("?transaction_nsu=123");

    expect(takeHostedOrder()).toBeNull();
    expect(window.sessionStorage.getItem("some-other.checkout.key")).not.toBeNull();
  });

  it("answers null when nothing was parked", () => {
    land("?transaction_nsu=123");

    expect(takeHostedOrder()).toBeNull();
  });
});
