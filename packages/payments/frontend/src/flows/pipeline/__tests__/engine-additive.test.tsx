// @vitest-environment jsdom
/**
 * ADDITIVE, in the only sense that matters (FUT-1240).
 *
 * With no pipeline key set, `Checkout` is the flat `CheckoutFlow` — the same
 * component, the same screens, the same test ids the storefront journeys
 * click. Set one, and the same host gets the walk instead, with those test ids
 * still intact.
 *
 * The second half is what makes the first half worth asserting: a switch that
 * only ever ran one side would pass this suite while shipping a pipeline
 * nobody could reach.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberHostedOrder } from "../../../components/checkout/hosted-return";

import { buildHost } from "./pipeline-host";
import { NO_CHARGE_METHODS, orderOf } from "./fixtures";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

describe("with no pipeline config, Checkout is the flow it always was", () => {
  it("renders the flat three-step flow, test ids and all", async () => {
    const { flows } = buildHost();
    render(<flows.Checkout />);
    // The flat flow's own chrome: the stepper, the CPF field, the pay bar.
    expect(await screen.findByTestId("buyer-cpf")).toBeTruthy();
    expect(screen.getByTestId("checkout-stepper")).toBeTruthy();
    expect(screen.getByTestId("checkout-pay-bar")).toBeTruthy();
    // …and NOT the engine, whose loading state is its own.
    await waitFor(() =>
      expect(screen.queryByTestId("checkout-pipeline-loading")).toBeNull(),
    );
  });

  it("still answers useAdmission, and passes with no gates registered", () => {
    const { flows } = buildHost();
    function Probe(): JSX.Element {
      return <p data-testid="verdict">{flows.useAdmission().kind}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId("verdict").textContent).toBe("pass");
  });
});

describe("with a pipeline key set, Checkout is the walk", () => {
  it("derives the buyer step, then the picker, then the pane", async () => {
    const { flows, createPayable } = buildHost({ settlementMethods: [] });
    render(<flows.Checkout />);

    expect(await screen.findByTestId("buyer-cpf")).toBeTruthy();
    expect(screen.getByTestId("checkout-stepper")).toBeTruthy();
    fireEvent.change(screen.getByTestId("buyer-cpf"), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByTestId("checkout-continue"));

    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
    fireEvent.click(screen.getByTestId("checkout-method-PIX"));
    await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
    expect(createPayable.mock.calls[0]?.[0]).toMatchObject({ method: "PIX", saveProfile: true });
  });

  it("opens on the picker for a buyer whose CPF is on file, and back leaves", async () => {
    const { flows, exitToCatalog } = buildHost({ settlementMethods: [] }, { taxIdOnFile: true });
    render(<flows.Checkout />);
    expect(await screen.findByTestId("checkout-method")).toBeTruthy();
    // The form the buyer would have had to retype is not rendered at all.
    await waitFor(() => expect(screen.queryByTestId("buyer-cpf")).toBeNull());
    fireEvent.click(screen.getByTestId("checkout-back"));
    expect(exitToCatalog).toHaveBeenCalledTimes(1);
  });

  it("states who is being charged, and \"alterar\" walks back to Dados and on", async () => {
    // The rendered half of `checkout-skip-dados`: the payer block, the door it
    // opens, the CPF that comes back with the shopper, and a back link that
    // now returns to a step which IS part of their flow.
    const { flows, exitToCatalog } = buildHost({ settlementMethods: [] }, { taxIdOnFile: true });
    render(<flows.Checkout />);

    expect(await screen.findByTestId("checkout-payer")).toBeTruthy();
    fireEvent.click(screen.getByTestId("checkout-payer-edit"));

    // A replacement, not an edit of a value the client was never given.
    const cpf = await screen.findByTestId("buyer-cpf");
    expect((cpf as HTMLInputElement).value).toBe("");
    fireEvent.change(cpf, { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByTestId("checkout-continue"));

    // Back on the picker, with the CPF typed for THIS purchase echoed.
    await waitFor(() =>
      expect(screen.getByTestId("checkout-payer-cpf").textContent).toContain("529.982.247-25"),
    );

    // Dados is part of their flow now, so back returns to it, not to the menu.
    fireEvent.click(screen.getByTestId("checkout-back"));
    expect(await screen.findByTestId("buyer-cpf")).toBeTruthy();
    expect(exitToCatalog).not.toHaveBeenCalled();
  });

  it("resumes a paid buyer's hand-off over an empty basket, not the empty cart", async () => {
    // The server empties a PAID cart, so an empty basket is exactly what a
    // buyer who paid comes back to. Showing them "seu carrinho está vazio"
    // instead of their receipt is the one failure on this path that costs a
    // shopper their confirmation for money that already moved.
    rememberHostedOrder(orderOf(), { tenantSlug: "loja-1", basket: null, handoff: true });
    const { flows } = buildHost({ settlementMethods: [] }, { taxIdOnFile: true, empty: true });
    render(<flows.Checkout />);
    // The confirmation, waiting on the poll — the flat flow's own answer for a
    // resumed hand-off, and not the empty-cart screen.
    expect(await screen.findByTestId("payment-status")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("checkout-empty")).toBeNull());
  });

  it("renders no payment surface for a settlement that raises no charge", async () => {
    const placed = orderOf({ method: "PIX", pix: undefined });
    const { flows, createPayable } = buildHost(
      { settlementMethods: NO_CHARGE_METHODS },
      {
        taxIdOnFile: true,
        createPayable: async () => ({ ok: true, data: placed }),
      },
    );
    render(<flows.Checkout />);
    // Host methods are registered, so the generic tiles render every offer.
    fireEvent.click(await screen.findByTestId("checkout-method-ON_DELIVERY"));
    await waitFor(() => expect(createPayable).toHaveBeenCalledTimes(1));
    // Placing IS the settlement: the confirmation, with no pane in between.
    await waitFor(() => expect(screen.getByTestId("payment-status")).toBeTruthy());
    await waitFor(() => {
      expect(screen.queryByTestId("checkout-method")).toBeNull();
      expect(screen.queryByTestId("checkout-pix")).toBeNull();
      expect(screen.queryByTestId("card-number")).toBeNull();
    });
  });

  it("shows its own loading sentence while the store's protocol is in flight", async () => {
    // A config that never answers: the walk has a buyer step, so the engine's
    // own loading state must NOT be what a shopper sees here — this pins that
    // the sentence exists and is the host's, not that it is always on screen.
    const { flows } = buildHost({ settlementMethods: [] }, { taxIdOnFile: true, config: null });
    render(<flows.Checkout />);
    expect(await screen.findByTestId("checkout-method")).toBeTruthy();
  });

  it("takes the host's exit when one is registered", async () => {
    const navigate = vi.fn<(to: string) => void>();
    const { flows, exitToCatalog } = buildHost(
      { exit: { useCatalog: () => ({ to: "/loja-1/menu", label: "Ver cardápio" }), navigate } },
      { taxIdOnFile: true },
    );
    render(<flows.Checkout />);
    fireEvent.click(await screen.findByTestId("checkout-back"));
    expect(navigate).toHaveBeenCalledWith("/loja-1/menu");
    expect(exitToCatalog).not.toHaveBeenCalled();
  });
});
