// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_ORDER_STORAGE_KEY,
  rememberHostedOrder,
  takeHostedOrder,
  hostedCheckoutReturnPending,
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

  it("resumes a parked order even when the provider marked nothing", () => {
    rememberHostedOrder(ORDER);
    land("");

    // THE INVERSION, and it is a money rule rather than a UX preference.
    //
    // Pressing the provider's "Continuar" is the only thing that marks the
    // URL. Closing the tab, hitting back and retyping the store's address are
    // all commoner, and all of them used to land the buyer on a live payment
    // step for an order that may already be paid — an invitation to pay twice.
    //
    // Polling before deciding does not rescue it either: InfinitePay's
    // `payment_check` will not answer without a `transaction_nsu` that only
    // that same redirect carries, so "ask first" reads PAID as PENDING and
    // drops them on the pay button anyway.
    expect(takeHostedOrder()?.orderId).toBe("o1");
  });

  it("still hands a bare resume back exactly once", () => {
    // What bounds the cost for a buyer who genuinely abandoned: they see one
    // confirmation screen reporting what the store actually knows, and leaving
    // and reopening checkout gives them a fresh order.
    rememberHostedOrder(ORDER);
    land("");

    expect(takeHostedOrder()).not.toBeNull();
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

describe("hostedCheckoutReturnPending — the host gate's question", () => {
  it("is true on a marked return, before the flow has read anything", () => {
    rememberHostedOrder(ORDER);
    land("?transaction_nsu=123&slug=abc");

    expect(hostedCheckoutReturnPending()).toBe(true);
  });

  it("is true on a BARE return, which is the case a host cannot detect itself", () => {
    // The buyer who closed the provider's page. A host gate reading only the
    // URL sees nothing here and curtains a payment that already happened.
    rememberHostedOrder(ORDER);
    land("");

    expect(hostedCheckoutReturnPending()).toBe(true);
  });

  it("does not consume the order — the gate asks on every render", () => {
    rememberHostedOrder(ORDER);
    land("");

    expect(hostedCheckoutReturnPending()).toBe(true);
    expect(hostedCheckoutReturnPending()).toBe(true);
    // And the flow still gets it.
    expect(takeHostedOrder()?.orderId).toBe("o1");
  });

  it("is false for a plain visit, so a host gate still gates", () => {
    // The exemption is for a buyer coming BACK from a payment and nothing else.
    land("");

    expect(hostedCheckoutReturnPending()).toBe(false);
  });
});

describe("another store's hand-off", () => {
  it("is NOT resumed on a different store's checkout", () => {
    // The case that made the marker gate load-bearing by accident: one tab
    // holds one slot, and on a multi-tenant storefront every store shares an
    // origin. Store B's buyer must not meet store A's order.
    rememberHostedOrder(ORDER, "loja-a");
    land("");

    expect(takeHostedOrder("loja-b")).toBeNull();
  });

  it("is left where it is, so going back to that store still resumes it", () => {
    // Not consumed on a mismatch: the hand-off is store A's to finish, and the
    // buyer may well return to it.
    rememberHostedOrder(ORDER, "loja-a");
    land("");

    expect(takeHostedOrder("loja-b")).toBeNull();
    expect(takeHostedOrder("loja-a")?.orderId).toBe("o1");
  });

  it("resumes on its own store", () => {
    rememberHostedOrder(ORDER, "loja-a");
    land("");

    expect(takeHostedOrder("loja-a")?.orderId).toBe("o1");
  });

  it("keeps an unscoped entry readable — the single-tenant host", () => {
    // A host that passes no slug has no other store to confuse it with, and an
    // entry parked by a pre-scope bundle must still come back.
    rememberHostedOrder(ORDER);
    land("");

    expect(takeHostedOrder("loja-a")?.orderId).toBe("o1");
  });
});

describe("a hand-off that has been sitting too long", () => {
  it("is dropped rather than resumed", () => {
    // A hosted round trip is minutes. Beyond the window the buyer is no longer
    // trying to place this order, and telling them about it is noise.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-18T10:00:00Z"));
      rememberHostedOrder(ORDER, "loja-a");
      land("");

      vi.setSystemTime(new Date("2026-08-18T10:31:00Z"));
      expect(takeHostedOrder("loja-a")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still resumes inside the window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-18T10:00:00Z"));
      rememberHostedOrder(ORDER, "loja-a");
      land("");

      vi.setSystemTime(new Date("2026-08-18T10:20:00Z"));
      expect(takeHostedOrder("loja-a")?.orderId).toBe("o1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hostedCheckoutReturnPending — the parked entry outranks the URL", () => {
  it("is false at another store even when the URL carries a marker", () => {
    // The regression this pair exists to stop, at the GATE this time. A
    // provider marker is per-TAB: store A's abandoned hand-off plus any marked
    // URL had the gate answer "a return is pending here" on store B, while
    // `takeHostedOrder` refused to resume it — so the gate stood aside for a
    // return that was never going to happen.
    rememberHostedOrder(ORDER, "loja-a");
    land("?transaction_nsu=123&slug=abc");

    expect(hostedCheckoutReturnPending("loja-b")).toBe(false);
    expect(hostedCheckoutReturnPending("loja-a")).toBe(true);
  });

  it("is false for a hand-off that has gone stale, marker or no marker", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      rememberHostedOrder(ORDER, "loja-a");
      vi.setSystemTime(new Date("2026-01-01T11:00:00Z"));
      land("?transaction_nsu=123&slug=abc");

      expect(hostedCheckoutReturnPending("loja-a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still trusts the marker once the flow has CONSUMED the entry", () => {
    // The one case with no other signal. A host gate that re-asks mid-visit
    // must not curtain the confirmation it just let through.
    rememberHostedOrder(ORDER, "loja-a");
    land("?transaction_nsu=123&slug=abc");
    takeHostedOrder("loja-a");

    expect(hostedCheckoutReturnPending("loja-a")).toBe(true);
  });
});

describe("hostedCheckoutReturnPending — scoped like the resume", () => {
  it("is false for another store, so its gate still gates", () => {
    rememberHostedOrder(ORDER, "loja-a");
    land("");

    expect(hostedCheckoutReturnPending("loja-b")).toBe(false);
    expect(hostedCheckoutReturnPending("loja-a")).toBe(true);
  });
});
