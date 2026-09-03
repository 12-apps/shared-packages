// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { basketSignature } from "../basket";
import {
  HOSTED_ORDER_STORAGE_KEY,
  hostedCheckoutReturnPending,
  rememberHostedOrder,
  takeHostedOrder,
  type HostedResumeDecision,
} from "../hosted-return";
import type { CheckoutOrder } from "../types";

/**
 * FUT-556 — surviving the trip to a hosted checkout, and FUT-1213 — not
 * resuming it over somebody's next basket.
 *
 * A redirect provider tears the SPA down. These pin the rules that keep the
 * return from landing on a blank payment step, and keep an ABANDONED payment
 * from resurfacing as if it had happened: the parked order is handed back once,
 * to its own store, and only while it is still about the basket in front of the
 * shopper.
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

/** The order, when the rule says resume — and null for every other verdict. */
function resumedOrder(decision: HostedResumeDecision): CheckoutOrder | null {
  return decision.verdict === "RESUME" ? decision.order : null;
}

/** Put the tab on `search`, the way the provider's redirect leaves it. */
function land(search: string): void {
  window.history.replaceState({}, "", `/loja/menu/checkout${search}`);
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
    rememberHostedOrder(ORDER, { handoff: true });
    land("?transaction_nsu=123&slug=abc");

    expect(resumedOrder(takeHostedOrder())).toEqual(ORDER);
  });

  it("recognises a return that carries only one of the markers", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("?slug=abc");

    expect(resumedOrder(takeHostedOrder())?.orderId).toBe("o1");
  });

  it("recognises a buyer coming back from a Stripe 3DS challenge (FUT-698)", () => {
    // What Stripe appends to the card confirm's `return_url` after the issuer
    // page: the intent id, its client secret and the redirect verdict.
    rememberHostedOrder(ORDER, { handoff: true });
    land("?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret&redirect_status=succeeded");

    expect(resumedOrder(takeHostedOrder())?.orderId).toBe("o1");
  });

  it("still recognises the hosted-store return exactly as before (FUT-556)", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("?transaction_nsu=123&slug=abc&order_nsu=o1");

    expect(resumedOrder(takeHostedOrder())?.orderId).toBe("o1");
  });

  it("resumes a parked order even when the provider marked nothing", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("");

    // THE INVERSION, and it is a money rule rather than a UX preference.
    //
    // Pressing the provider's "Continuar" is the only thing that marks the
    // URL. Closing the tab, hitting back and retyping the store's address are
    // all commoner, and all of them used to land the buyer on a live payment
    // step for an order that may already be paid — an invitation to pay twice.
    expect(resumedOrder(takeHostedOrder())?.orderId).toBe("o1");
  });

  it("still hands a bare resume back exactly once", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("");

    expect(resumedOrder(takeHostedOrder())).not.toBeNull();
    expect(resumedOrder(takeHostedOrder())).toBeNull();
  });

  it("answers null for a value that is not an order", () => {
    window.sessionStorage.setItem(HOSTED_ORDER_STORAGE_KEY, '{"nonsense":true}');
    land("?transaction_nsu=123");

    expect(takeHostedOrder().verdict).toBe("NONE");
  });

  it("answers null for unparseable storage rather than throwing", () => {
    window.sessionStorage.setItem(HOSTED_ORDER_STORAGE_KEY, "{not json");
    land("?transaction_nsu=123");

    expect(takeHostedOrder().verdict).toBe("NONE");
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

    expect(resumedOrder(takeHostedOrder())?.orderId).toBe(ORDER.orderId);
    // Cleared like any other read, so a later return trip cannot resume it.
    expect(window.sessionStorage.getItem(legacyKey)).toBeNull();
  });

  it("prefers the current key when both are somehow present", () => {
    const legacyKey = atob("ZnV0dXJlcGF5LmNoZWNrb3V0Lmhvc3RlZE9yZGVy");
    window.sessionStorage.setItem(legacyKey, JSON.stringify({ ...ORDER, orderId: "stale" }));
    window.sessionStorage.setItem(HOSTED_ORDER_STORAGE_KEY, JSON.stringify(ORDER));
    land("?transaction_nsu=123");

    expect(resumedOrder(takeHostedOrder())?.orderId).toBe(ORDER.orderId);
  });

  it("ignores a value under any other name — no generic key scan", () => {
    window.sessionStorage.setItem("some-other.checkout.key", JSON.stringify(ORDER));
    land("?transaction_nsu=123");

    expect(takeHostedOrder().verdict).toBe("NONE");
    expect(window.sessionStorage.getItem("some-other.checkout.key")).not.toBeNull();
  });

  it("answers null when nothing was parked", () => {
    land("?transaction_nsu=123");

    expect(takeHostedOrder().verdict).toBe("NONE");
  });
});

describe("hostedCheckoutReturnPending — the host gate's question", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });

  it("is true on a marked return, before the flow has read anything", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("?transaction_nsu=123&slug=abc");

    expect(hostedCheckoutReturnPending()).toBe(true);
  });

  it("is true on a BARE return, which is the case a host cannot detect itself", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("");

    expect(hostedCheckoutReturnPending()).toBe(true);
  });

  it("does not consume the order — the gate asks on every render", () => {
    rememberHostedOrder(ORDER, { handoff: true });
    land("");

    expect(hostedCheckoutReturnPending()).toBe(true);
    expect(hostedCheckoutReturnPending()).toBe(true);
    expect(resumedOrder(takeHostedOrder())?.orderId).toBe("o1");
  });

  it("is false for a plain visit, so a host gate still gates", () => {
    land("");

    expect(hostedCheckoutReturnPending()).toBe(false);
  });
});

describe("another store's hand-off", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });

  it("is NOT resumed on a different store's checkout", () => {
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });

    expect(takeHostedOrder("loja-b").verdict).toBe("NONE");
  });

  it("is left where it is, so going back to that store still resumes it", () => {
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });

    expect(takeHostedOrder("loja-b").verdict).toBe("NONE");
    expect(resumedOrder(takeHostedOrder("loja-a"))?.orderId).toBe("o1");
  });

  it("keeps an unscoped entry readable — the single-tenant host", () => {
    rememberHostedOrder(ORDER, { handoff: true });

    expect(resumedOrder(takeHostedOrder("loja-a"))?.orderId).toBe("o1");
  });
});

describe("a hand-off that has been sitting too long", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });

  it("is dropped rather than resumed", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-18T10:00:00Z"));
      rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });

      vi.setSystemTime(new Date("2026-08-18T10:31:00Z"));
      expect(takeHostedOrder("loja-a").verdict).toBe("NONE");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still resumes inside the window", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-18T10:00:00Z"));
      rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });

      vi.setSystemTime(new Date("2026-08-18T10:20:00Z"));
      expect(resumedOrder(takeHostedOrder("loja-a"))?.orderId).toBe("o1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hostedCheckoutReturnPending — the parked entry outranks the URL", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });

  it("is false at another store even when the URL carries a marker", () => {
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });
    land("?transaction_nsu=123&slug=abc");

    expect(hostedCheckoutReturnPending("loja-b")).toBe(false);
    expect(hostedCheckoutReturnPending("loja-a")).toBe(true);
  });

  it("is false for a hand-off that has gone stale, marker or no marker", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });
      vi.setSystemTime(new Date("2026-01-01T11:00:00Z"));
      land("?transaction_nsu=123&slug=abc");

      expect(hostedCheckoutReturnPending("loja-a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still trusts the marker once the flow has CONSUMED the entry", () => {
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });
    land("?transaction_nsu=123&slug=abc");
    takeHostedOrder("loja-a");

    expect(hostedCheckoutReturnPending("loja-a")).toBe(true);
  });
});

/**
 * FUT-1213 — the rule itself, one branch at a time.
 *
 * The two cases the ticket names verbatim are the first two here; the rest are
 * the branches around them, because a rule with four answers that is only
 * tested on two of them is a rule with two untested answers.
 */
describe("a parked hand-off met by another basket", () => {
  const RAISED_FROM = basketSignature([{ id: "line-1", quantity: 2 }]);
  const READY = (signature: string | null): { signature: string | null; ready: boolean } => ({
    signature,
    ready: true,
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("a parked order is dropped when a different basket stands and the order is not paid", () => {
    // The verdict is ASK rather than a drop, because "not paid" is not knowable
    // here — it is the server's answer, and the caller is the one that asks.
    // What this pins is that the entry does NOT resume itself over the basket
    // in front of the shopper, and that it is still there for the ask.
    rememberHostedOrder(ORDER, { basket: RAISED_FROM, handoff: true });

    const decision = takeHostedOrder(undefined, READY(basketSignature([{ id: "line-9", quantity: 1 }])));

    expect(decision.verdict).toBe("ASK");
    expect(resumedOrder(decision)).toBeNull();
    // Left parked: the caller has not had its answer yet, and dropping it
    // before the server speaks is how a paid buyer loses their confirmation.
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).not.toBeNull();
  });

  it("is resumed when the order is PAID", () => {
    // The other half of the same branch, at the seam this module owns: the
    // basket comparison hands the order to the caller to ask about, and the
    // caller resumes it on the confirmation. `use-hosted-resume` drives the
    // whole path end to end.
    rememberHostedOrder(ORDER, { basket: RAISED_FROM, handoff: true });

    const decision = takeHostedOrder(undefined, READY(basketSignature([{ id: "x", quantity: 1 }])));

    expect(decision.verdict === "ASK" ? decision.order.orderId : null).toBe("o1");
  });

  it("resumes without asking when the SAME basket is still standing", () => {
    rememberHostedOrder(ORDER, { basket: RAISED_FROM, handoff: true });

    const decision = takeHostedOrder(undefined, READY(RAISED_FROM));

    expect(decision.verdict).toBe("RESUME");
    expect(resumedOrder(decision)?.orderId).toBe("o1");
  });

  it("resumes without asking when the basket is EMPTY — the paid buyer's state", () => {
    // The server closes a paid cart inside the confirmation transaction, so an
    // empty basket is exactly what a buyer who paid comes back to. Asking here
    // would put a request between them and their confirmation for nothing.
    rememberHostedOrder(ORDER, { basket: RAISED_FROM, handoff: true });

    const decision = takeHostedOrder(undefined, READY(null));

    expect(decision.verdict).toBe("RESUME");
  });

  it("decides NOTHING while the host's cart is still loading", () => {
    // The whole rule turns on the basket, and a cart that has not answered yet
    // is empty in exactly the way a real one is not. Deciding here reads every
    // basket as empty, which is the branch that resumes unconditionally.
    rememberHostedOrder(ORDER, { basket: RAISED_FROM, handoff: true });

    expect(takeHostedOrder(undefined, { signature: null, ready: false }).verdict).toBe("WAIT");
    // And nothing was consumed, so the real decision can still be made.
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).not.toBeNull();
  });

  it("resumes an entry parked with no basket at all — the pre-1213 behaviour", () => {
    // An older bundle, or a host that wires no identity. There is nothing to
    // compare, and inventing a comparison would drop payments for every host
    // that has not adopted the port yet.
    rememberHostedOrder(ORDER, { handoff: true });

    expect(takeHostedOrder(undefined, READY("something-else")).verdict).toBe("RESUME");
  });

  it("resumes when the host names no basket, whatever was parked", () => {
    rememberHostedOrder(ORDER, { basket: RAISED_FROM, handoff: true });

    expect(takeHostedOrder().verdict).toBe("RESUME");
  });
});

/**
 * FUT-1140 — where a resumed order opens.
 *
 * A hand-off has nothing left on our page, so it resumes on the confirmation.
 * A PIX code raised here is still the thing the buyer needs to look at, and
 * the server reuses the same charge — so it resumes on the payment step, where
 * the pane's own poll carries them to the confirmation when it settles.
 */
describe("where a resumed checkout opens", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });

  it("puts a hand-off on the confirmation, which is the only screen it has", () => {
    rememberHostedOrder(ORDER, { basket: "a", handoff: true });

    const decision = takeHostedOrder(undefined, { signature: "a", ready: true });

    expect(decision.verdict === "RESUME" ? decision.step : null).toBe("status");
  });

  it("puts a code raised on our own page back in front of the buyer", () => {
    rememberHostedOrder(ORDER, { basket: "a" });

    const decision = takeHostedOrder(undefined, { signature: "a", ready: true });

    expect(decision.verdict === "RESUME" ? decision.step : null).toBe("payment");
  });

  it("puts it on the confirmation instead once the cart has been closed", () => {
    // An empty basket after a raised order means the server settled it and
    // emptied the cart. Showing that buyer a QR would be showing them a code
    // for money they have already sent.
    rememberHostedOrder(ORDER, { basket: "a" });

    const decision = takeHostedOrder(undefined, { signature: null, ready: true });

    expect(decision.verdict === "RESUME" ? decision.step : null).toBe("status");
  });
});

describe("basketSignature", () => {
  it("does not depend on the order the host holds its lines in", () => {
    const one = basketSignature([
      { id: "a", quantity: 1 },
      { id: "b", quantity: 3 },
    ]);
    const other = basketSignature([
      { id: "b", quantity: 3 },
      { id: "a", quantity: 1 },
    ]);

    expect(one).toBe(other);
  });

  it("changes when a quantity changes", () => {
    expect(basketSignature([{ id: "a", quantity: 1 }])).not.toBe(
      basketSignature([{ id: "a", quantity: 2 }]),
    );
  });

  it("answers null for an empty basket, which is a state and not a gap", () => {
    expect(basketSignature([])).toBeNull();
  });
});

/**
 * FUT-1213 — the host GATE asks the same question the resume does.
 *
 * `ClosedStoreGate` stands aside for a buyer coming back from a payment, and
 * standing aside is the whole of that screen. The ticket names the harm: a
 * stale entry made the curtain stand aside, so an abandoned shopper met
 * "Confirmando seu pagamento" where they should have met "Loja fechada" — and
 * FUT-1216's decision 2 is that a closed store BLOCKS.
 *
 * The predicate that satisfies both is the resume's own: this store, not stale,
 * and still about the basket in front of the shopper.
 */
describe("hostedCheckoutReturnPending — weighed against the basket", () => {
  const RAISED_FROM = basketSignature([{ id: "line-1", quantity: 2 }]);

  beforeEach(() => {
    window.sessionStorage.clear();
    land("");
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("stands the gate aside when the SAME basket is still standing", () => {
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", basket: RAISED_FROM, handoff: true });

    expect(
      hostedCheckoutReturnPending("loja-a", { signature: RAISED_FROM, ready: true }),
    ).toBe(true);
  });

  it("stands it aside for an EMPTY basket, which is the paid buyer's state", () => {
    // The server closes a paid cart inside the confirmation transaction, so
    // this is what a buyer who paid comes back to — and they must reach
    // "Pedido confirmado" whether the store is open or shut.
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", basket: RAISED_FROM, handoff: true });

    expect(hostedCheckoutReturnPending("loja-a", { signature: null, ready: true })).toBe(true);
  });

  it("does NOT stand it aside for a shopper holding a different basket", () => {
    // By the resume's own step 3 this shopper is not a payer. At a shut store
    // they are exactly who has to meet "Loja fechada".
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", basket: RAISED_FROM, handoff: true });

    expect(
      hostedCheckoutReturnPending("loja-a", {
        signature: basketSignature([{ id: "line-9", quantity: 1 }]),
        ready: true,
      }),
    ).toBe(false);
  });

  it("does not stand it aside when nothing is parked at all", () => {
    expect(hostedCheckoutReturnPending("loja-a", { signature: RAISED_FROM, ready: true })).toBe(
      false,
    );
  });

  it("stands it aside while the host's cart has not loaded", () => {
    // Nothing is known yet, and the permissive answer is the one that cannot
    // strand a payer. A host freezing this at mount must not freeze it here.
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", basket: RAISED_FROM, handoff: true });

    expect(hostedCheckoutReturnPending("loja-a", { signature: null, ready: false })).toBe(true);
  });

  it("keeps the WIDE answer for a host that names no basket", () => {
    // The pre-1213 behaviour, kept so an un-migrated host is not broken by a
    // bump — and the reason a migrating host must pass the basket HERE too.
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", basket: RAISED_FROM, handoff: true });

    expect(hostedCheckoutReturnPending("loja-a")).toBe(true);
  });

  it("stands aside for an entry parked with no basket, whatever is in the cart", () => {
    // An older bundle parked it: there is nothing to compare, and refusing on
    // that basis would curtain a payer mid-upgrade.
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", handoff: true });

    expect(
      hostedCheckoutReturnPending("loja-a", { signature: "something-else", ready: true }),
    ).toBe(true);
  });

  it("still refuses another store's entry, basket or no basket", () => {
    rememberHostedOrder(ORDER, { tenantSlug: "loja-a", basket: RAISED_FROM, handoff: true });

    expect(
      hostedCheckoutReturnPending("loja-b", { signature: RAISED_FROM, ready: true }),
    ).toBe(false);
  });
});
