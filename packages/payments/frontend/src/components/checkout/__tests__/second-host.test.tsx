// @vitest-environment jsdom
/**
 * The second-host proof (FUT-564 acceptance).
 *
 * This package's dependency graph contains NO `@12-apps/ui` — it is not even
 * resolvable from here — so a green run of this suite IS the proof that a host
 * without this repo's design system can mount the buyer checkout: every pixel
 * below renders through the raw-MUI default slots (`mui-defaults.tsx`),
 * because no `components` prop is passed and no provider sits above the flow.
 *
 * The walk is the buyer's own: Dados (CPF form, consent checkbox, pay bar) →
 * Pagamento (method picker) → the card form, with the order raised through the
 * host port. The load-bearing test ids must survive the default slots too —
 * they are the same hooks the storefront journeys click.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow } from "../checkout-flow";
import type { CheckoutOrder, CreateOrderRequest, CreateOrderResult } from "../types";

afterEach(cleanup);

const CARD_ORDER: CheckoutOrder = {
  orderId: "o-2nd-host",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 1000,
  subtotalCents: 1000,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 10,00",
};

/** A valid CPF (passes the client-side check digits). */
const VALID_CPF = "52998224725";

describe("CheckoutFlow with no design system present (raw-MUI default slots)", () => {
  it("walks Dados → Pagamento → card form through the default slots", async () => {
    const createOrder = vi.fn<(input: CreateOrderRequest) => Promise<CreateOrderResult>>(
      async () => ({ ok: true, data: CARD_ORDER }),
    );

    render(
      <CheckoutFlow
        cart={{ empty: false, totalLabel: "R$ 10,00", totalItems: 1 }}
        createOrder={createOrder}
        onExitToMenu={vi.fn()}
      />,
    );

    // Dados renders through the defaults: stepper, CPF field, consent, pay bar.
    expect(screen.getByTestId("checkout-stepper")).toBeTruthy();
    expect(screen.getByTestId("buyer-save-profile")).toBeTruthy();
    expect(screen.getByTestId("checkout-pay-bar")).toBeTruthy();

    fireEvent.change(screen.getByTestId("buyer-cpf"), { target: { value: VALID_CPF } });
    fireEvent.click(screen.getByTestId("checkout-continue"));

    // Pagamento: the method picker, with both in-browser methods on offer.
    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
    expect(screen.getByTestId("checkout-method-PIX")).toBeTruthy();

    // Choosing card auto-raises the order through the HOST port…
    fireEvent.click(screen.getByTestId("checkout-method-CARD"));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(createOrder.mock.calls[0]?.[0]).toMatchObject({ method: "CARD", saveProfile: true });

    // …and the card form renders, again through the default slots.
    await waitFor(() => expect(screen.getByTestId("card-number")).toBeTruthy());
    expect(screen.getByTestId("card-holder")).toBeTruthy();
    expect(screen.getByTestId("card-pay")).toBeTruthy();
  });

  it("shows the empty-cart state for a cart with nothing to pay", () => {
    render(
      <CheckoutFlow
        cart={{ empty: true, totalLabel: "R$ 0,00", totalItems: 0 }}
        createOrder={vi.fn()}
        onExitToMenu={vi.fn()}
      />,
    );

    expect(screen.getByTestId("checkout-empty")).toBeTruthy();
  });
});
