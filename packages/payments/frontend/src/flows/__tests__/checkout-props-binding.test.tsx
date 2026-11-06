// @vitest-environment jsdom
/**
 * `createCheckoutPropsBinding` (FUT-1241): the packaged flow, fed the props a
 * host hands `<CheckoutFlow>`, draws the SAME screen — the shopper must see no
 * difference between a lane on the hand mount and a lane on the factory.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow, type CheckoutFlowProps } from "../../components/checkout/checkout-flow";
import { PT_BR_PAYMENT_LIST_COPY } from "../../components/checkout/list/pt-BR";
import { STORY_CHECKOUT_COPY } from "../../stories/demo-copy";
import { createStoryStore } from "../../stories/store";
import { createCheckoutPropsBinding } from "../checkout-props-binding";
import { createPaymentFlows } from "../create-payment-flows";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** A counter lane not paid online: one in-person row, and the host's "no online provider" answer. */
function counterProps(over: Partial<CheckoutFlowProps> = {}): CheckoutFlowProps {
  return {
    copy: STORY_CHECKOUT_COPY.views,
    cart: { empty: false, totalLabel: "R$ 75,00", totalItems: 2 },
    createOrder: () => Promise.reject(new Error("not raised")),
    onExitToMenu: () => undefined,
    defaultBuyer: { name: "Ana Compradora", email: "ana@exemplo.com", phone: "11999990000", taxId: "" },
    taxIdOnFile: true,
    taxIdKindOnFile: "CNPJ",
    providerConfig: { provider: null, tokenization: null, publicKey: null, mockTokenization: false, methods: [] },
    tenantSlug: "loja-1",
    paymentList: {
      copy: PT_BR_PAYMENT_LIST_COPY,
      totalCents: 7500,
      door: [{ id: "counter", label: "Pagar no balcão", action: "Enviar pedido", blocked: null, onSend: () => undefined }],
    },
    ...over,
  };
}

/** A binding over a real story mount, with its `/config` reads counted. */
function bound(): { Checkout: (props: CheckoutFlowProps) => JSX.Element; configReads: string[] } {
  const world = createStoryStore({});
  const configReads: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/config")) configReads.push(String(input));
    return world.fetchImpl(input, init);
  }) as typeof fetch;
  const binding = createCheckoutPropsBinding({ copy: STORY_CHECKOUT_COPY, transport: { fetchImpl } });
  const Mounted = binding.mount(createPaymentFlows(binding.config));
  return { Checkout: (props) => <Mounted {...props} />, configReads };
}

/** What the buyer sees on Pagamento: its words, and which controls are there. */
async function pagamento(): Promise<{ text: string; ids: string[] }> {
  const list = await screen.findByTestId("payment-list");
  await waitFor(() => expect(screen.queryByTestId("list-top-loading")).toBeNull());
  const ids = [...list.querySelectorAll("[data-testid]")].map((node) => node.getAttribute("data-testid") ?? "");
  return { text: list.textContent ?? "", ids };
}

describe("the factory over <CheckoutFlow>'s props (FUT-1241)", () => {
  it("draws the same Pagamento as the hand mount, with the in-person row and no /config read", async () => {
    render(<CheckoutFlow {...counterProps()} />);
    const hand = await pagamento();
    cleanup();

    const { Checkout, configReads } = bound();
    render(<Checkout {...counterProps()} />);
    const packaged = await pagamento();

    expect(packaged).toEqual(hand);
    expect(packaged.ids).toContain("list-door-counter");
    expect(configReads).toEqual([]);
  });

  it("raises the order and leaves through the ports of the LATEST props", async () => {
    const exits: string[] = [];
    const { Checkout } = bound();
    function Host(): JSX.Element {
      const [round, setRound] = useState("primeira");
      return (
        <>
          <button type="button" data-testid="host-change" onClick={() => setRound("segunda")}>
            trocar
          </button>
          <Checkout {...counterProps({ cart: { empty: true, totalLabel: "", totalItems: 0 }, onExitToMenu: () => exits.push(round) })} />
        </>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByTestId("host-change"));
    fireEvent.click(await screen.findByTestId("checkout-empty-back"));
    expect(exits).toEqual(["segunda"]);
  });

  it("refuses a bound Checkout mounted outside its mount", () => {
    const binding = createCheckoutPropsBinding({ copy: STORY_CHECKOUT_COPY });
    const flows = createPaymentFlows(binding.config);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<flows.Checkout />)).toThrow(/outside its `mount`/);
  });
});
