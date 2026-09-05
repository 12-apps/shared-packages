// @vitest-environment jsdom
/**
 * BACK, ONCE THE MONEY HAS MOVED (FUT-1240).
 *
 * `useCheckoutNav` maps `back` to Dados only from `payment`; from `status` it
 * goes to the menu, whatever the buyer has on file. The derived walk has to
 * answer the same, and "the previous applying step" alone does not: a paid PIX
 * order leaves its pane APPLYING (an order exists, nothing handed over) and
 * merely COMPLETE, so the previous applying step behind the confirmation is the
 * payment surface for money that already moved.
 *
 * That is the hazard `ADOPTING.md` already records — "an already-proven
 * connection renders the proof, never the pay button. One owner read a
 * re-offered button as 'it did not work' and paid four times." A confirmation
 * that can be reversed into a live pay button is that failure with an extra
 * tap in front of it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckoutProviderConfig } from "../../../components/checkout/types";

import { STUB_CONFIG, buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** A CPF that passes the check digits, so the Dados gate lets the buyer past. */
const GOOD_CPF = "529.982.247-25";

/**
 * A store whose charge and whose poll both answer PAID.
 *
 * The point of stubbing at the TRANSPORT rather than at a port is that the
 * terminal state is reached the way a shopper reaches it — the pane's own poll
 * resolves it — so the walk under test is the one a paid shopper is actually
 * standing in.
 */
function paidStore(config: CheckoutProviderConfig | null = STUB_CONFIG): typeof fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/config")) return json({ data: config });
    if (url.includes("/charge")) return json({ data: { status: "PAID" } });
    if (url.includes("/status")) return json({ data: "PAID" });
    if (url.includes("/cards")) return json({ data: [] });
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  };
  return impl as typeof fetch;
}

/** Fill the new-card form with a PAN the stub tokenizer accepts. */
function fillCard(): void {
  fireEvent.change(screen.getByTestId("card-number"), {
    target: { value: "4111 1111 1111 1111" },
  });
  fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA COMPRADORA" } });
  fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/34" } });
  fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
}

describe("back on a settled confirmation leaves for the catalog", () => {
  it("does not re-offer the Pix pane for an order that is already paid", async () => {
    const { flows, exitToCatalog } = buildHost(
      { settlementMethods: [], transport: { fetchImpl: paidStore() } },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    // The pane's own poll answers PAID, so the walk reaches the confirmation
    // exactly as a shopper does.
    expect(await screen.findByTestId("payment-status")).toBeTruthy();

    fireEvent.click(screen.getByTestId("checkout-back"));
    expect(exitToCatalog).toHaveBeenCalledTimes(1);
    // Still the receipt: nothing behind it is a place to send a paid shopper.
    expect(screen.getByTestId("payment-status")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("pix-view")).toBeNull());
  });

  it("does not re-offer the card form, with its live pay button", async () => {
    const { flows, exitToCatalog } = buildHost(
      { settlementMethods: [], transport: { fetchImpl: paidStore() } },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-CARD"));
    await screen.findByTestId("card-number");
    fillCard();
    fireEvent.click(screen.getByTestId("card-pay"));
    expect(await screen.findByTestId("payment-status")).toBeTruthy();

    fireEvent.click(screen.getByTestId("checkout-back"));
    expect(exitToCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("payment-status")).toBeTruthy();
    // The pay button is the whole of the hazard: a shopper who reads a
    // re-offered one as "it did not work" pays twice.
    await waitFor(() => expect(screen.queryByTestId("card-pay")).toBeNull());
  });

  it("still walks back to Dados from the picker, for a buyer who typed one", async () => {
    // The other half of `useCheckoutNav`, and the reason the rule is stated
    // over the OUTCOME rather than over the last step: before anything settles,
    // back is still the previous applying step.
    const { flows, exitToCatalog } = buildHost(
      { settlementMethods: [], transport: { fetchImpl: paidStore() } },
    );
    render(<flows.Checkout />);

    fireEvent.change(await screen.findByTestId("buyer-cpf"), { target: { value: GOOD_CPF } });
    fireEvent.click(screen.getByTestId("checkout-continue"));
    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());

    fireEvent.click(screen.getByTestId("checkout-back"));
    expect(await screen.findByTestId("buyer-cpf")).toBeTruthy();
    expect(exitToCatalog).not.toHaveBeenCalled();
  });
});

describe("the confirmation's own way out is the same way out", () => {
  it("takes the registered exit, not the port the chrome already left behind", async () => {
    // Two exits with two answers is the defect: the chrome's back honours a
    // registered `exit`, so a confirmation that ignores it sends the same
    // shopper to two different catalogs depending on which control they press.
    const navigate = vi.fn<(to: string) => void>();
    const { flows, exitToCatalog } = buildHost(
      {
        settlementMethods: [],
        transport: { fetchImpl: paidStore() },
        exit: { useCatalog: () => ({ to: "/loja-1/menu", label: "Ver cardápio" }), navigate },
      },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);

    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));
    expect(await screen.findByTestId("payment-status")).toBeTruthy();

    fireEvent.click(screen.getByTestId("payment-back-to-menu"));
    expect(navigate).toHaveBeenCalledWith("/loja-1/menu");
    expect(exitToCatalog).not.toHaveBeenCalled();
  });
});
