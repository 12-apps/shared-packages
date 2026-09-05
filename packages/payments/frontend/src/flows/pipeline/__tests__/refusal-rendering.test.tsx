// @vitest-environment jsdom
/**
 * A REFUSAL THE SHOPPER CAN READ (FUT-1240).
 *
 * `refusal-routing.ts` decides WHO answers a code. This suite asks the only
 * question that matters to a shopper: whatever that decision is, does the
 * sentence reach a screen?
 *
 * The case the routing gets wrong on its own is a code a GATE claimed. A gate
 * that would refuse curtains the checkout before anyone can press pay, so the
 * only way a gate-claimed code comes back from the server is with that gate
 * PASSING — and a passing gate draws nothing. Routed to it and dropped, the
 * shopper presses pay, the server refuses, and the screen does not change.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateOrderResult } from "../../../components/checkout/types";
import type { AnyCheckoutGate, AnyCheckoutStep } from "../types";

import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

const CLOSED_MESSAGE = "A loja está fechada agora";

/** A create port that refuses with one code, always. */
function refusingWith(code: string, message: string) {
  return async (): Promise<CreateOrderResult> => ({
    ok: false,
    error: { code, message, field: null },
  });
}

/**
 * A gate that CLAIMS the store's own refusal code and admits everyone.
 *
 * Not a contrivance: it is the ordinary shape. A store-open gate reads the
 * store's opening hours, and the hours say open — the server refusing anyway
 * is precisely the disagreement the shopper has to be told about.
 */
const PASSING_OPEN_GATE: AnyCheckoutGate = {
  id: "store-open",
  answersCodes: ["STORE_CLOSED"],
  decide: () => ({ kind: "pass" }),
};

/** A step that claims a code and draws its own complaint. */
const ADDRESS_STEP: AnyCheckoutStep = {
  id: "address",
  phase: "details",
  order: 1,
  answersCodes: ["DELIVERY_ADDRESS_REQUIRED"],
  applies: () => true,
  complete: () => true,
  render: ({ error }) =>
    error === null ? <p data-testid="address-step" /> : <p data-testid="address-error">{error.message}</p>,
};

describe("a code its gate claimed, with that gate passing", () => {
  it("reaches the shopper on the step they are standing on", async () => {
    const { flows } = buildHost(
      { settlementMethods: [], gates: [PASSING_OPEN_GATE] },
      {
        taxIdOnFile: true,
        createPayable: refusingWith("STORE_CLOSED", CLOSED_MESSAGE),
      },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    const panel = await screen.findByTestId("checkout-error");
    expect(panel.textContent).toContain(CLOSED_MESSAGE);
  });
});

describe("the rest of the routing is unchanged", () => {
  it("shows a code nobody claimed wherever the shopper is standing", async () => {
    const { flows } = buildHost(
      { settlementMethods: [] },
      {
        taxIdOnFile: true,
        createPayable: refusingWith("GATEWAY_UNAVAILABLE", "Tente de novo em instantes"),
      },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    const panel = await screen.findByTestId("checkout-error");
    expect(panel.textContent).toContain("Tente de novo em instantes");
  });

  it("moves the shopper to the step that claimed the code, and draws it there", async () => {
    const { flows } = buildHost(
      { settlementMethods: [], steps: [ADDRESS_STEP] },
      {
        taxIdOnFile: true,
        createPayable: refusingWith("DELIVERY_ADDRESS_REQUIRED", "Falta o número"),
      },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    const claimed = await screen.findByTestId("address-error");
    expect(claimed.textContent).toBe("Falta o número");
    // Its claimant draws it, so the engine does not draw a second copy.
    await waitFor(() => expect(screen.queryByTestId("checkout-error")).toBeNull());
  });
});
