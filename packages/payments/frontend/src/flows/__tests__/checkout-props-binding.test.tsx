// @vitest-environment jsdom
/**
 * `createCheckoutPropsBinding` (FUT-1241): the packaged flow, fed the props a
 * host hands `<CheckoutFlow>`, draws the SAME screen — the shopper must see no
 * difference between a lane on the hand mount and a lane on the factory.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow, type CheckoutFlowProps } from "../../components/checkout/checkout-flow";
import { orderFor, onPageStore } from "../../components/checkout/__tests__/list-harness";
import { EN_US_CHECKOUT_VIEW_COPY } from "../../components/checkout/en-US";
import { HOSTED_ORDER_STORAGE_KEY, rememberHostedOrder } from "../../components/checkout/hosted-return";
import { createCheckoutClient } from "../../components/checkout/transport";
import { CHARGE_WINDOW_MS } from "../../components/checkout/list/use-list-charge";
import { EN_US_PAYMENT_LIST_COPY } from "../../components/checkout/list/en-US";
import { PT_BR_PAYMENT_LIST_COPY } from "../../components/checkout/list/pt-BR";
import { STORY_CHECKOUT_COPY } from "../../stories/demo-copy";
import { createStoryStore } from "../../stories/store";
import { CHECKOUT_PROP_ROUTES, createCheckoutPropsBinding } from "../checkout-props-binding";
import { createPaymentFlows } from "../create-payment-flows";
import { useFlowClient, useFlowPorts, type FlowsRuntime } from "../runtime";
import type { CheckoutCopyFE } from "../copy";
import type { CheckoutPorts } from "../types";

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
function bound(transportFetch?: typeof fetch): { Checkout: (props: CheckoutFlowProps) => JSX.Element; configReads: string[] } {
  const world = createStoryStore({});
  const configReads: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/config")) configReads.push(String(input));
    return world.fetchImpl(input, init);
  }) as typeof fetch;
  const binding = createCheckoutPropsBinding({ copy: STORY_CHECKOUT_COPY, transport: { fetchImpl: transportFetch ?? fetchImpl } });
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

describe("what the bound mount must not lose against the hand mount (FUT-1241, review round 1)", () => {
  it("speaks the transport's failures in the buyer's language, not the copy the flow was built with", async () => {
    // Built with the pt-BR pack, as a host binds at module scope; the props
    // carry the buyer's en-US words, as the hand mount's do.
    const offline = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const { Checkout } = bound(offline);
    render(
      <Checkout
        {...counterProps({
          copy: EN_US_CHECKOUT_VIEW_COPY,
          providerConfig: onPageStore({ methods: ["CARD"] }),
          createOrder: () => Promise.resolve({ ok: true, data: orderFor("CARD") }),
          paymentList: { copy: EN_US_PAYMENT_LIST_COPY, totalCents: 2700, door: [] },
        })}
      />,
    );
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-top-loading")).toBeNull());
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

    expect(await screen.findByText(EN_US_CHECKOUT_VIEW_COPY.screens.screens.transport.offline)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(STORY_CHECKOUT_COPY.views.screens.screens.transport.offline)).toBeNull());
  });

  it("draws the list, never the factory's unavailable screen, for an empty chain with no in-person row", async () => {
    // What the hand mount draws for a Comprar basket or a closed conta: the
    // list, with no rows — the host decides "not paid online" above the mount.
    const { Checkout } = bound();
    render(
      <Checkout
        {...counterProps({
          providerConfig: { ...onPageStore({ methods: [] }), chain: [] },
          paymentList: { copy: PT_BR_PAYMENT_LIST_COPY, totalCents: 7500, door: [] },
        })}
      />,
    );
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("checkout-payments-disabled")).toBeNull());
  });

  it("forwards parkHostedOrders={false}: the parked Pix is left for the host's checkout", async () => {
    const parked = { ...orderFor("PIX"), orderId: "checkout-pix" };
    rememberHostedOrder(parked, { tenantSlug: "loja-1" });
    const before = window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY);
    const { Checkout } = bound();
    render(
      <Checkout
        {...counterProps({ parkHostedOrders: false, providerConfig: onPageStore({ methods: ["PIX"] }) })}
      />,
    );

    expect(await screen.findByRole("radio", { name: /Pix/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-pix")).toBeNull());
    expect(window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY)).toBe(before);
  });

  it("routes every CheckoutFlow prop", () => {
    // Every key REQUIRED, so a new prop is a compile error HERE as well as on
    // the routes table; the runtime half compares the two lists.
    const every: { [K in keyof Required<CheckoutFlowProps>]: CheckoutFlowProps[K] } = {
      ...counterProps(),
      defaultBuyer: undefined,
      taxIdOnFile: true,
      taxIdKindOnFile: null,
      providerConfig: null,
      tenantSlug: "loja-1",
      settlement: null,
      saveBuyerContact: () => undefined,
      onPaid: () => undefined,
      validateApplePayMerchant: () => Promise.resolve({}),
      confirmationExtra: null,
      confirmationHero: null,
      confirmationFooter: null,
      backActionEmphasis: "primary",
      components: {},
      parkHostedOrders: true,
    };
    expect(Object.keys(CHECKOUT_PROP_ROUTES).sort()).toEqual(Object.keys(every).sort());
  });
});

describe("useFlowPorts' optional wrappers", () => {
  /** A runtime whose host ports are whatever `current` holds on this render. */
  function portsRuntime(current: { ports: CheckoutPorts }): FlowsRuntime {
    return { useHostPorts: () => current.ports } as unknown as FlowsRuntime;
  }
  const base: CheckoutPorts = { createPayable: () => Promise.reject(new Error("unused")), exitToCatalog: () => undefined };

  it("calls the saveBuyerContact and onPaid the host answered last", () => {
    const calls: string[] = [];
    const current = {
      ports: { ...base, saveBuyerContact: () => void calls.push("save-1"), onPaid: () => void calls.push("paid-1") } as CheckoutPorts,
    };
    const { result, rerender } = renderHook(() => useFlowPorts(portsRuntime(current)));
    current.ports = { ...base, saveBuyerContact: () => void calls.push("save-2"), onPaid: () => void calls.push("paid-2") };
    rerender();
    result.current.saveBuyerContact?.({ name: "Ana", phone: "11999990000" });
    result.current.onPaid?.();
    expect(calls).toEqual(["save-2", "paid-2"]);
  });

  it("rejects a merchant validation whose port went missing after the first render", async () => {
    const current = { ports: { ...base, validateApplePayMerchant: () => Promise.resolve({ ok: true }) } as CheckoutPorts };
    const { result, rerender } = renderHook(() => useFlowPorts(portsRuntime(current)));
    const validate = result.current.validateApplePayMerchant;
    current.ports = { ...base };
    rerender();
    await expect(validate?.("https://apple.example/validate")).rejects.toThrow(/no merchant validation port/);
  });
});

describe("useFlowClient: the client follows the transport words' IDENTITY (FUT-1241, review round 2)", () => {
  /** A runtime built with the story pack, whose host answers `useCopy` with whatever `current` holds. */
  function copyRuntime(current: { copy: CheckoutCopyFE }): FlowsRuntime {
    const client = createCheckoutClient({ copy: STORY_CHECKOUT_COPY.views.screens.screens.transport });
    return {
      config: { copy: STORY_CHECKOUT_COPY, useCopy: () => current.copy },
      client,
      copy: STORY_CHECKOUT_COPY,
    } as unknown as FlowsRuntime;
  }
  /** The buyer's en-US words, held once — as a locale's pack is. */
  const ENGLISH: CheckoutCopyFE = { ...STORY_CHECKOUT_COPY, views: EN_US_CHECKOUT_VIEW_COPY };

  it("keeps ONE client across renders for a copy whose transport words keep their identity", () => {
    const runtime = copyRuntime({ copy: ENGLISH });
    const { result, rerender } = renderHook(() => useFlowClient(runtime));
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
    // …and it is the buyer's client, not the one built with the flow.
    expect(first).not.toBe(runtime.client);
  });

  it("keeps it too when the rest of the copy is a fresh object each render", () => {
    const current = { copy: { ...ENGLISH } };
    const runtime = copyRuntime(current);
    const { result, rerender } = renderHook(() => useFlowClient(runtime));
    const first = result.current;
    current.copy = { ...ENGLISH, views: { ...ENGLISH.views, screens: ENGLISH.views.screens } };
    rerender();
    expect(result.current).toBe(first);
  });

  it("rebuilds it when the transport words are a new object — why `useCopy` must not rebuild them", () => {
    const current = { copy: ENGLISH };
    const runtime = copyRuntime(current);
    const { result, rerender } = renderHook(() => useFlowClient(runtime));
    const first = result.current;
    const screens = ENGLISH.views.screens;
    current.copy = { ...ENGLISH, views: { ...ENGLISH.views, screens: { ...screens, screens: { ...screens.screens, transport: { ...screens.screens.transport } } } } };
    rerender();
    expect(result.current).not.toBe(first);
  });
});
