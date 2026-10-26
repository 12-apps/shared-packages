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
 * The walk is the buyer's own: Pagamento as the one list (the CPF at its top,
 * the rows, the bar) → the card row's form, with the order raised through the
 * host port when the bar is pressed (FUT-4028). The load-bearing test ids must survive the default slots too —
 * they are the same hooks the storefront journeys click.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow } from "../checkout-flow";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { CheckoutOrder, CreateOrderRequest, CreateOrderResult } from "../types";
import { onPageStore, renderList, stubClient } from "./list-harness";

afterEach(cleanup);
// A raised order is parked in `sessionStorage` now (FUT-1140), and these suites
// share one jsdom tab — so without this, one test's checkout resumes the
// previous test's payment.
beforeEach(() => window.sessionStorage.clear());

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
  it("walks the list → the card form → the bar through the default slots", async () => {
    const createOrder = vi.fn<(input: CreateOrderRequest) => Promise<CreateOrderResult>>(
      async () => ({ ok: true, data: CARD_ORDER }),
    );

    renderList({ config: onPageStore(), client: stubClient(), createOrder, taxIdOnFile: false, buyer: {} });

    // Pagamento renders through the defaults: the CPF at the top, the rows, the bar.
    await screen.findByTestId("payment-list");
    expect(screen.getByTestId("list-option-PIX")).toBeTruthy();
    expect(screen.getByTestId("list-option-CARD")).toBeTruthy();
    fireEvent.change(await screen.findByTestId("list-buyer-taxId"), { target: { value: VALID_CPF } });

    // Choosing the card opens its form, again through the default slots…
    fireEvent.click(screen.getByTestId("list-option-CARD-radio"));
    await waitFor(() => expect(screen.getByTestId("card-number")).toBeTruthy());
    expect(screen.getByTestId("card-holder")).toBeTruthy();
    // …and nothing is raised until the bar is pressed: the pick alone sends nothing.
    expect(screen.getByTestId("list-pay")).toBeTruthy();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("shows the empty-cart state for a cart with nothing to pay", () => {
    render(
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: true, totalLabel: "R$ 0,00", totalItems: 0 }}
        createOrder={vi.fn()}
        onExitToMenu={vi.fn()}
        paymentList={{ copy: PT_BR_PAYMENT_LIST_COPY }}
      />,
    );

    expect(screen.getByTestId("checkout-empty")).toBeTruthy();
  });
});
