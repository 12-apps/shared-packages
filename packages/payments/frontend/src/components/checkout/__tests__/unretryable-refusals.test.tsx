// @vitest-environment jsdom
/**
 * FUT-1182 — "Tentar novamente" is only offered where trying again could work.
 *
 * The Pagamento step drew ONE shape for every refusal it did not recognise: a
 * red Alert plus a retry that re-POSTs the identical order. For a refusal about
 * the payment — an unreachable gateway, a CPF the provider rejected, a card
 * that failed — that is right, and the button is the correct affordance.
 *
 * For a refusal about the WORLD it is not. The shop is shut, the mode is
 * switched off, the booked slot is gone, the basket is already paid for, the
 * store has connected no provider: re-sending the same request is guaranteed to
 * produce the same answer, so the most prominent control on the screen was one
 * that could only fail again, worded as though the buyer had mistyped something.
 *
 * The other half of this ticket is the host's (FUT-1166): it acts on the same
 * codes — refetching the store, the book, the service config — so the screen
 * BEHIND the message corrects itself into the gate that says what the buyer can
 * actually do. This half's job is not to offer a button that fights it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

import { CheckoutFlow } from "../checkout-flow";
import { PaymentErrorPanel } from "../payment-error-panel";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";

/** The server's own sentence, whatever it was — the panel renders it verbatim. */
const REFUSAL = "A loja está fechada no momento.";

/** The affordance under test, named from the pack rather than retyped. */
const RETRY_LABEL = PT_BR_CHECKOUT_SCREENS_COPY.error.retryAction;

function renderPanel(code: string | null): HTMLElement {
  return render(
    <PaymentErrorPanel
      message={REFUSAL}
      emailFlagged={false}
      code={code}
      onUseEmail={vi.fn()}
      onRetry={vi.fn()}
    />,
  ).container;
}

describe("a refusal that re-sending cannot fix", () => {
  it.each([
    ["STORE_CLOSED"],
    ["SCHEDULE_UNAVAILABLE"],
    ["MODE_UNAVAILABLE"],
    ["PAYMENTS_NOT_CONFIGURED"],
    ["PAYMENT_NOT_CONFIGURED"],
    ["CART_ALREADY_PAID"],
    ["BASKET_ALREADY_BOUGHT"],
    ["EMPTY_CART"],
    ["COMANDA_CLOSED"],
    ["DELIVERY_UNAVAILABLE"],
    ["DELIVERY_ADDRESS_REQUIRED"],
  ])("offers no retry for %s", (code) => {
    const container = renderPanel(code);

    // The message stays: the buyer is owed the reason, and the host's own gate
    // is arriving behind it.
    expect(screen.getByTestId("checkout-error")).toBeTruthy();
    // Asserted on what IS rendered rather than on an element going away —
    // nothing here is asynchronous, so the panel never offered a control at all.
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("a refusal that trying again could genuinely clear", () => {
  it.each([
    // A provider outage, a gateway that could not be reached: the next attempt
    // meets a different world.
    ["PAYMENT_UNAVAILABLE"],
    ["GATEWAY_UNAVAILABLE"],
    // The buyer's own details, which they can correct on this very step.
    ["INVALID_TAX_ID"],
    ["MISSING_BUYER_FIELD"],
    ["INVALID_BUYER_FIELD"],
    ["CHARGE_MISMATCH"],
  ])("keeps the retry for %s", (code) => {
    renderPanel(code);

    expect(screen.getByTestId("checkout-retry-payment")).toBeTruthy();
  });

  it("keeps it for a refusal that carried no code at all", () => {
    // SILENCE MEANS YES, the same rule a card decline follows (FUT-1145). A
    // server one release ahead, a route answering a bare `{ error }`, a host
    // that has not adopted the vocabulary — none of those is a reason to take
    // away the one control the screen has.
    renderPanel(null);

    expect(screen.getByTestId("checkout-retry-payment")).toBeTruthy();
  });

  it("keeps it for a code this bundle has never heard of", () => {
    renderPanel("SOMETHING_ADDED_LATER");

    expect(screen.getByTestId("checkout-retry-payment")).toBeTruthy();
  });
});

describe("the Pagamento step a shut store refuses", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("says why, and offers nothing that re-sends the same order", async () => {
    const createOrder = vi.fn(async () => ({
      ok: false as const,
      error: { message: REFUSAL, field: null, code: "STORE_CLOSED" },
    }));

    const { container } = render(
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 24,00", totalItems: 1 }}
        createOrder={createOrder}
        onExitToMenu={vi.fn()}
        taxIdOnFile
      />,
    );

    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await waitFor(() => expect(screen.getByTestId("checkout-error")).toBeTruthy());

    // The buyer keeps the store's own sentence — the host's gate is arriving
    // behind it — and the one control that could only fail again is gone. Read
    // off the rendered TEXT because this step legitimately has other buttons,
    // and because nothing here is asynchronous: the label was never drawn.
    expect(screen.getByText(REFUSAL)).toBeTruthy();
    expect(container.textContent).not.toContain(RETRY_LABEL);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});
