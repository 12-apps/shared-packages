// @vitest-environment jsdom
/**
 * What a host hands `createPaymentFlows` PER RENDER (FUT-1241).
 *
 * A storefront binding the factory on its counter must see no difference from
 * the `<CheckoutFlow>` it mounts by hand today. Three things stood in the way,
 * each pinned here against the same real mount `create-payment-flows.test.tsx`
 * drives:
 *
 *   A. an empty provider chain refused the whole list, in-person rows and all;
 *   B. `Checkout` always fetched `/config` itself, so the host's own answer for
 *      the lane was dropped and the store was read twice;
 *   C. copy, the confirmation, the kind of document on file and the ports were
 *      fixed when the flow was built, so a host had to rewrite a ref on every
 *      render to keep them current.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createContext, useContext, useState, type JSX, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARGE_WINDOW_MS } from "../../components/checkout/list/use-list-charge";
import { PT_BR_PAYMENT_LIST_COPY } from "../../components/checkout/list/pt-BR";
import type { CheckoutDoorOption, CheckoutPaymentList } from "../../components/checkout/list/types";
import type { CheckoutProviderConfig, CreateOrderRequest } from "../../components/checkout/types";
import { STORY_CHECKOUT_COPY } from "../../stories/demo-copy";
import { storyFlows } from "../../stories/host";
import type { CheckoutPorts, PaymentFlowsConfig } from "../types";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** The in-person row a counter store offers: paid at the counter, no provider involved. */
function counterRow(onSend: () => void = () => undefined): CheckoutDoorOption {
  return { id: "counter", label: "Pagar no balcão", action: "Enviar pedido", blocked: null, onSend };
}

/** The one list, with the host's in-person rows. */
function listWith(door: readonly CheckoutDoorOption[]): () => CheckoutPaymentList {
  const list: CheckoutPaymentList = { copy: PT_BR_PAYMENT_LIST_COPY, totalCents: 7500, door };
  return () => list;
}

/** A provider answer with nothing to charge online — what a host states for a lane not paid online. */
const NO_ONLINE: CheckoutProviderConfig = {
  provider: null,
  tokenization: null,
  publicKey: null,
  mockTokenization: false,
  methods: [],
};

/** A fetch spy over the story mount, counting the `/config` reads. */
function countingConfigReads(): { reads: () => number; wrap: (inner: typeof fetch) => typeof fetch } {
  const reads: string[] = [];
  return {
    reads: () => reads.length,
    wrap: (inner) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/config")) reads.push(String(input));
        return inner(input, init);
      }) as typeof fetch,
  };
}

/** Choose the card row, fill a PAN the stub accepts, press Pagar and let the window run out. */
async function payByCard(): Promise<void> {
  await screen.findByTestId("payment-list");
  await waitFor(() => expect(screen.queryByTestId("list-top-loading")).toBeNull());
  const cpf = screen.queryByTestId("list-buyer-taxId");
  if (cpf) fireEvent.change(cpf, { target: { value: "529.982.247-25" } });
  fireEvent.click(screen.getByTestId("list-option-CARD-radio"));
  await waitFor(() => expect(screen.getByTestId("card-number")).toBeTruthy());
  fireEvent.change(screen.getByTestId("card-number"), { target: { value: "4111 1111 1111 1111" } });
  fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA COMPRADORA" } });
  fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/34" } });
  fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
  vi.useFakeTimers();
  fireEvent.click(screen.getByTestId("list-pay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
  });
  vi.useRealTimers();
}

const CARD_ONLY = { chain: [{ name: "aurora", methods: ["CARD" as const], stub: true, publicKey: null }] };

/** A host value that changes after the first render, the way a host's state does. */
const HostWord = createContext("primeira");

function WithWord({ children }: { children: ReactNode }): JSX.Element {
  const [word, setWord] = useState("primeira");
  return (
    <HostWord.Provider value={word}>
      <button type="button" data-testid="host-change" onClick={() => setWord("segunda")}>
        trocar
      </button>
      {children}
    </HostWord.Provider>
  );
}

describe("A. an empty chain beside the host's in-person rows (FUT-1241)", () => {
  it("draws the list with the in-person row, not the unavailable screen", async () => {
    const { flows } = storyFlows({ chain: [] }, { usePaymentList: listWith([counterRow()]) });
    render(<flows.Checkout />);
    await screen.findByTestId("payment-list");
    expect(screen.getByTestId("list-door-counter")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("checkout-payments-disabled")).toBeNull());
  });

  it("sends the pedido through the in-person row", async () => {
    const onSend = vi.fn();
    const { flows } = storyFlows({ chain: [] }, { usePaymentList: listWith([counterRow(onSend)]) });
    render(<flows.Checkout />);
    fireEvent.click(await screen.findByTestId("list-door-counter-radio"));
    await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("list-pay"));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  it("still refuses an empty chain with no in-person row", async () => {
    const { flows } = storyFlows({ chain: [] }, { usePaymentList: listWith([]) });
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("checkout-payments-disabled")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("payment-list")).toBeNull());
  });

  it("still honours the host's veto, in-person rows or not", async () => {
    const { flows } = storyFlows(
      { chain: [] },
      { usePaymentList: listWith([counterRow()]), availability: { payable: false } },
    );
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("checkout-payments-disabled")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("payment-list")).toBeNull());
  });
});

describe("B. the host's own provider answer (FUT-1241)", () => {
  it("is the answer the list draws, and /config is never fetched", async () => {
    const counter = countingConfigReads();
    // The store HAS a live chain; the host states that this lane is not paid online.
    const { world } = storyFlows();
    const { flows } = storyFlows(
      {},
      { usePaymentList: listWith([counterRow()]) },
      {
        transport: { fetchImpl: counter.wrap(world.fetchImpl) },
        useProviderConfig: () => ({ config: NO_ONLINE, pending: false }),
      },
    );
    render(<flows.Checkout />);
    await screen.findByTestId("payment-list");
    expect(screen.getByTestId("list-door-counter")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-option-PIX")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD")).toBeNull());
    expect(counter.reads()).toBe(0);
  });

  it("fetches /config once when the host has no answer of its own", async () => {
    const counter = countingConfigReads();
    const { world } = storyFlows();
    const { flows } = storyFlows({}, {}, {
      transport: { fetchImpl: counter.wrap(world.fetchImpl) },
      useProviderConfig: () => undefined,
    });
    render(<flows.Checkout />);
    await screen.findByTestId("list-option-PIX");
    expect(counter.reads()).toBe(1);
  });

  it("waits while the host's answer is in flight, refusing nothing", async () => {
    const { flows } = storyFlows({ chain: [] }, {}, {
      useProviderConfig: () => ({ config: null, pending: true }),
    });
    render(<flows.Checkout />);
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("checkout-payments-disabled")).toBeNull());
  });
});

describe("C. values read per render (FUT-1241)", () => {
  it("draws the copy the host's useCopy answers on THIS render", async () => {
    const useCopy = (): PaymentFlowsConfig["copy"] => {
      const word = useContext(HostWord);
      const views = STORY_CHECKOUT_COPY.views;
      return { ...STORY_CHECKOUT_COPY, views: { ...views, emptyCart: { ...views.emptyCart, title: `Sacola ${word}` } } };
    };
    const { flows } = storyFlows({}, { cart: { empty: true } }, { useCopy });
    render(
      <WithWord>
        <flows.Checkout />
      </WithWord>,
    );
    await waitFor(() => expect(screen.getByText("Sacola primeira")).toBeTruthy());
    fireEvent.click(screen.getByTestId("host-change"));
    await waitFor(() => expect(screen.getByText("Sacola segunda")).toBeTruthy());
  });

  it("draws the confirmation the host's useConfirmation answers, hero and footer", async () => {
    const useConfirmation = () => {
      const word = useContext(HostWord);
      return {
        hero: <span data-testid="host-hero">{`herói ${word}`}</span>,
        footer: <p data-testid="host-footer">{`rodapé ${word}`}</p>,
        backActionEmphasis: "primary" as const,
      };
    };
    const { flows } = storyFlows(CARD_ONLY, {}, { useConfirmation });
    render(
      <WithWord>
        <flows.Checkout />
      </WithWord>,
    );
    await payByCard();
    await waitFor(() => expect(screen.getByTestId("payment-paid")).toBeTruthy());
    expect(screen.getByTestId("host-hero").textContent).toBe("herói primeira");
    fireEvent.click(screen.getByTestId("host-change"));
    await waitFor(() => expect(screen.getByTestId("host-footer").textContent).toBe("rodapé segunda"));
  });

  it("forwards the KIND of document on file, so a saved CNPJ is not read as a CPF", async () => {
    const { flows } = storyFlows({}, {}, {
      useBuyerDefaults: () => ({
        buyer: { name: "Ana Compradora", email: "ana@exemplo.com", phone: "11999990000", taxId: "" },
        taxIdOnFile: true,
        taxIdKindOnFile: "CNPJ",
      }),
    });
    render(<flows.Checkout />);
    const payer = await screen.findByTestId("list-payer");
    expect(payer.textContent).toContain("CNPJ");
    expect(payer.textContent).not.toContain("CPF");
  });

  it("calls the ports the host's usePorts answered LAST, with no static ports at all", async () => {
    const raised: string[] = [];
    const { world } = storyFlows(CARD_ONLY);
    const usePorts = (): CheckoutPorts => {
      const word = useContext(HostWord);
      return {
        createPayable: async (input: CreateOrderRequest) => {
          raised.push(word);
          const response = await world.createPayable({ method: input.method, buyer: input.buyer });
          const body = (await response.json()) as { data: { invoice: string; total: number; totalLabel: string } };
          return {
            ok: true,
            data: {
              orderId: body.data.invoice,
              status: "AWAITING_PAYMENT",
              method: input.method,
              totalCents: body.data.total,
              subtotalCents: body.data.total,
              discountTotalCents: 0,
              appliedDiscounts: [],
              totalLabel: body.data.totalLabel,
            },
          };
        },
        exitToCatalog: () => undefined,
      };
    };
    const { flows } = storyFlows(CARD_ONLY, {}, {
      transport: { fetchImpl: world.fetchImpl },
      ports: undefined,
      usePorts,
    });
    render(
      <WithWord>
        <flows.Checkout />
      </WithWord>,
    );
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("host-change"));
    await payByCard();
    await waitFor(() => expect(raised).toEqual(["segunda"]));
  });

  it("leaves through the exit the host's usePorts answered last", async () => {
    const exits: string[] = [];
    const usePorts = (): CheckoutPorts => {
      const word = useContext(HostWord);
      return { createPayable: () => Promise.reject(new Error("not raised")), exitToCatalog: () => exits.push(word) };
    };
    const { flows } = storyFlows({}, { cart: { empty: true } }, { ports: undefined, usePorts });
    render(
      <WithWord>
        <flows.Checkout />
      </WithWord>,
    );
    fireEvent.click(screen.getByTestId("host-change"));
    fireEvent.click(await screen.findByTestId("checkout-empty-back"));
    expect(exits).toEqual(["segunda"]);
  });

  it("refuses a flow built with neither ports nor usePorts", () => {
    expect(() => storyFlows({}, {}, { ports: undefined })).toThrow(/ports/);
  });
});
