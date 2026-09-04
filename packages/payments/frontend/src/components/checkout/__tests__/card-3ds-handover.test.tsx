// @vitest-environment jsdom
/**
 * FUT-698 — "Dado uma loja Stripe, quando o comprador paga com um cartão que
 * exige 3DS, então ele é levado ao desafio" — the browser-unreachable half of
 * that scenario (the stub adapter settles cards inline, so no e2e journey can
 * produce a real challenge). The return half — "e volta com o pedido pago
 * exatamente uma vez" — is the hosted-return machinery, pinned in
 * hosted-return.test.ts and settled server-side by the idempotent webhook path.
 *
 * The charge answers `hostedCheckoutUrl` and the card hook must hand the buyer
 * over exactly as a redirect provider's link does (FUT-556): park the order,
 * navigate, and start NO poll in a tab that is being torn down.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX } from "react";

import { HOSTED_ORDER_STORAGE_KEY } from "../hosted-return";

const client = vi.hoisted(() => ({
  chargeCard: vi.fn(),
  listSavedCards: vi.fn(),
  refreshCardPublicKey: vi.fn(),
  pollOrderStatus: vi.fn(),
  fetchCheckoutConfig: vi.fn(),
}));

vi.mock("../client", () => client);

import type { CardTokenizationConfig } from "../../../card";
import type { CheckoutOrder, OrderStatus } from "../types";
import { useCardCheckout } from "../use-card-checkout";

const ORDER: CheckoutOrder = {
  orderId: "o1",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 1250,
  subtotalCents: 1250,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 12,50",
};

const STRIPE_CONFIG: CardTokenizationConfig = {
  provider: "stripe",
  publicKey: "pk_test_1",
  mockTokenization: false,
};

/** A saved card, so paying skips tokenization and goes straight to the charge. */
const SAVED_CARD = {
  id: "card-1",
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2033,
  holder: "OLGA STONE",
};

function Harness({ onResolved }: { onResolved: (status: OrderStatus) => void }): JSX.Element {
  const cc = useCardCheckout(ORDER, {}, STRIPE_CONFIG, onResolved, 10, "acme", [], false, {
    tenantSlug: "acme",
    basket: { signature: "line-1x2", ready: true },
  });
  return (
    <div>
      <span data-testid="submitted">{String(cc.submitted)}</span>
      <span data-testid="selection">{cc.selection}</span>
      <button type="button" data-testid="pay" onClick={() => void cc.handlePay()}>
        Pagar
      </button>
    </div>
  );
}

/** Render, wait for the saved card to be SELECTED, and tap Pagar. */
async function pay(onResolved = vi.fn()): Promise<void> {
  render(<Harness onResolved={onResolved} />);
  // Selection — not merely the fetch — is what routes handlePay past the
  // empty new-card form; clicking earlier validates that form and stops.
  await waitFor(() => {
    expect(screen.getByTestId("selection").textContent).toBe("card-1");
  });
  fireEvent.click(screen.getByTestId("pay"));
}

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  client.listSavedCards.mockResolvedValue([SAVED_CARD]);
  client.pollOrderStatus.mockResolvedValue({ ok: true, data: "AWAITING_PAYMENT" });
  vi.stubGlobal("location", { search: "", assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("card charge → 3DS handover (FUT-698)", () => {
  it("hands the buyer to the challenge page with the order parked for the return trip", async () => {
    client.chargeCard.mockResolvedValue({
      ok: true,
      data: { status: "AWAITING_PAYMENT", hostedCheckoutUrl: "https://hooks.stripe.com/3ds/x" },
    });
    const onResolved = vi.fn();

    await pay(onResolved);

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://hooks.stripe.com/3ds/x");
    });
    // Parked exactly as the redirect-provider handoff parks (FUT-556), so the
    // return trip resumes THIS order's confirmation screen.
    // The exported constant, not a literal: a private copy of the key here
    // would keep passing against the old name while the module wrote the new
    // one, which is exactly the drift this assertion exists to catch.
    const parked = window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY);
    expect(parked).not.toBeNull();
    // The parked payload is an ENVELOPE since the cross-store fix: the order,
    // the store it belongs to, and when it was parked. A bare order in the slot
    // is what let one store's hand-off resume on another store's checkout.
    const envelope = JSON.parse(parked as string) as {
      order: { orderId: string };
      parkedAt: number;
      tenantSlug?: string;
      basket?: string | null;
      handoff?: boolean;
    };
    expect(envelope.order.orderId).toBe("o1");
    expect(typeof envelope.parkedAt).toBe("number");
    // …and with the SAME facts the redirect-provider hand-off records
    // (FUT-1213). This call site named neither, and both absences read as "no
    // opinion" to the resume: an entry with no store resumes at any store, and
    // one with no basket resumes over any basket. A challenge the buyer
    // abandoned was exempt from both.
    expect(envelope).toMatchObject({
      tenantSlug: "acme",
      basket: "line-1x2",
      handoff: true,
    });
    // The tab is navigating away: nothing resolved, no poll started here.
    expect(onResolved).not.toHaveBeenCalled();
    expect(client.pollOrderStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId("submitted").textContent).toBe("false");
  });

  it("an accepted charge WITHOUT a challenge begins polling instead of navigating", async () => {
    client.chargeCard.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } });

    await pay();

    await waitFor(() => {
      expect(screen.getByTestId("submitted").textContent).toBe("true");
    });
    expect(assign).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toBeNull();
  });

  it("a decline resolves to the status screen, never a handover", async () => {
    client.chargeCard.mockResolvedValue({ ok: true, data: { status: "FAILED" } });
    const onResolved = vi.fn();

    await pay(onResolved);

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith("FAILED");
    });
    expect(assign).not.toHaveBeenCalled();
  });
});
