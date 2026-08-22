// @vitest-environment jsdom
/**
 * FUT-563 — a charge NOBODY can confirm is not a charge that failed.
 *
 * `PAYMENT_UNRESOLVED` means some provider may be holding the buyer's money and
 * no probe could say. It is the one refusal where inviting a retry is actively
 * harmful, and both checkout surfaces used to do exactly that: the card view
 * put "não pague de novo" under a danger heading reading "Não foi possível
 * pagar", with the live "Pagar R$ …" bar directly beneath it; the Pagamento
 * step gave the same body a solid "Tentar novamente" that mints a SECOND order
 * at a new reference, outside the walk's re-probe of the first.
 *
 * What is pinned here is the presentation, not the words: the code decides it,
 * so a copy edit cannot silently turn the affordance back on.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  chargeCard: vi.fn(),
  listSavedCards: vi.fn(),
  refreshCardPublicKey: vi.fn(),
  pollOrderStatus: vi.fn(),
  fetchCheckoutConfig: vi.fn(),
}));

vi.mock("../client", () => client);

import { CardView } from "../card-view";
import { PaymentErrorPanel } from "../payment-error-panel";
import type { CheckoutOrder } from "../types";

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

const UNRESOLVED =
  "Estamos confirmando o seu pagamento com o provedor. NÃO pague de novo — se a cobrança " +
  "foi feita, ela será confirmada sozinha.";

/**
 * A card already in the vault. Paying with it needs no tokenizer and no typing,
 * which keeps these tests about the RENDERING of the answer.
 */
const SAVED = {
  id: "card_1",
  brand: "visa",
  last4: "1111",
  expMonth: 12,
  expYear: 2034,
  holder: "VERA CADEIA",
};

beforeEach(() => {
  vi.clearAllMocks();
  client.listSavedCards.mockResolvedValue([SAVED]);
  client.refreshCardPublicKey.mockResolvedValue({ ok: true, data: { publicKey: null } });
  client.pollOrderStatus.mockResolvedValue({ ok: true, data: "AWAITING_PAYMENT" });
});

afterEach(() => {
  cleanup();
});

describe("the CARD view", () => {
  /** Render the card form and drive a submit whose charge comes back `code`d. */
  async function submitWith(failure: { error: string; code?: string }): Promise<void> {
    client.chargeCard.mockResolvedValue({ ok: false, ...failure });
    render(
      <CardView
        order={ORDER}
        providerConfig={{ provider: "pagbank", publicKey: null, mockTokenization: true }}
        providerChain={[
          { provider: "pagbank", publicKey: null, mockTokenization: true, mintable: true },
        ]}
        onResolved={vi.fn()}
      />,
    );
    // The saved card is preselected once the list lands, so the pay bar is
    // everything this submit needs.
    await waitFor(() => {
      expect(screen.getByTestId("saved-cards")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("card-pay-bar").querySelector("button") as HTMLElement);
    await waitFor(() => {
      expect(client.chargeCard).toHaveBeenCalled();
    });
  }

  it("shows an UNRESOLVED charge as a warning, and takes the pay bar away", async () => {
    await submitWith({ error: UNRESOLVED, code: "PAYMENT_UNRESOLVED" });

    // Not "Não foi possível pagar": the buyer reads the bold title first, and
    // that one contradicts the body's own instruction. And the one action the
    // message forbids is not on screen at all.
    await waitFor(() => {
      expect(screen.getByTestId("card-unresolved")).toBeTruthy();
      expect(screen.queryByTestId("card-error")).toBeNull();
      expect(screen.queryByTestId("card-pay-bar")).toBeNull();
    });
    expect(screen.getByText("Estamos confirmando seu pagamento")).toBeTruthy();
  });

  it("still shows an ordinary failure as a failure, with the pay bar intact", async () => {
    await submitWith({ error: "Cartão recusado.", code: "PAYMENT_UNAVAILABLE" });

    await waitFor(() => {
      expect(screen.getByTestId("card-error")).toBeTruthy();
    });
    expect(screen.getByTestId("card-pay-bar")).toBeTruthy();
  });
});

describe("the Pagamento step's error panel", () => {
  it("offers NO retry for an unresolved charge", () => {
    const { container } = render(
      <PaymentErrorPanel
        message={UNRESOLVED}
        emailFlagged={false}
        code="PAYMENT_UNRESOLVED"
        onUseEmail={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    // "Tentar novamente" re-runs createOrder: a new order at a new reference,
    // which the walk's re-probe of the old one cannot protect.
    expect(screen.getByTestId("checkout-unresolved")).toBeTruthy();
    // Asserted on the rendered TEXT: nothing here is asynchronous, so this is
    // not an element that went away — the affordance was never offered.
    expect(container.textContent).not.toContain("Tentar novamente");
  });

  it("keeps the retry for every other refusal", () => {
    render(
      <PaymentErrorPanel
        message="Não foi possível criar o pedido."
        emailFlagged={false}
        code="EMPTY_CART"
        onUseEmail={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId("checkout-error")).toBeTruthy();
    expect(screen.getByTestId("checkout-retry-payment")).toBeTruthy();
  });
});
