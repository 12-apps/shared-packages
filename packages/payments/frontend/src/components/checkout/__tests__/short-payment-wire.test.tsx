// @vitest-environment jsdom
/**
 * FUT-612 — option C's two acts are WIRED by the package: a host only says
 * where its routes are (`CheckoutTransport.shortPaymentRoutes`, or
 * `<CheckoutFlow shortPaymentRoutes>` when mounted by hand), and the flow
 * raises the balance order and asks for the refund through the client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { PaymentShortfall } from "@12-apps/payments-backend";

import { useCheckoutClientApi } from "../client-context";
import { CheckoutCopyProvider } from "../copy-context";
import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import { PT_BR_CHECKOUT_COPY } from "../pt-BR";
import { createCheckoutClient } from "../transport";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { onPageStore, orderFor, renderList, stubClient } from "./list-harness";
import { renderHook } from "./test-utils";

const SHORT: PaymentShortfall = { totalCents: 2070, paidCents: 690, dueCents: 1380, paidMethod: "PIX", resolution: null };
const ROUTES = { payDifference: "/host/orders/:ref/balance", refund: "/host/orders/:ref/refund" };
const copy = PT_BR_CHECKOUT_COPY.screens.transport;

/** A fetch that answers `body` with `status`, recording what it was asked. */
function fetchAnswering(body: unknown, status = 200) {
  return vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json(body, { status }));
}

const sent = (fetchImpl: ReturnType<typeof fetchAnswering>) => {
  const [url, init] = fetchImpl.mock.calls[0]!;
  return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

describe("the short-payment wire of createCheckoutClient", () => {
  it("raises the balance order at the configured route, with the order ref in it", async () => {
    const order = orderFor("PIX", { orderId: "o 1", totalCents: 1380 });
    const fetchImpl = fetchAnswering({ data: order });
    const client = createCheckoutClient({ copy, fetchImpl, shortPaymentRoutes: ROUTES });

    const answered = await client.payDifference!({ orderId: "o 1", method: "PIX", taxId: "12345678909" });

    expect(sent(fetchImpl)).toEqual({ url: "/host/orders/o%201/balance", method: "POST", body: { method: "PIX", taxId: "12345678909" } });
    expect(answered).toEqual({ ok: true, data: order });
  });

  it("asks for the refund at the configured route and answers the status detail", async () => {
    const fetchImpl = fetchAnswering({ data: "FAILED", shortfall: { ...SHORT, resolution: "REFUNDED" } });
    const client = createCheckoutClient({ copy, fetchImpl, shortPaymentRoutes: ROUTES });

    const answered = await client.requestShortRefund!("o1");

    expect(sent(fetchImpl)).toMatchObject({ url: "/host/orders/o1/refund", method: "POST" });
    expect(answered).toEqual({ ok: true, data: { status: "FAILED", shortfall: { ...SHORT, resolution: "REFUNDED" } } });
  });

  it("defaults both routes under baseUrl", async () => {
    const fetchImpl = fetchAnswering({ data: "FAILED" });
    const client = createCheckoutClient({ copy, fetchImpl, baseUrl: "/pay" });

    await client.requestShortRefund!("o1");
    await client.payDifference!({ orderId: "o1", method: "CARD" });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("/pay/orders/o1/short-refund");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("/pay/orders/o1/pay-difference");
  });

  it("keeps the server's sentence and code on a refusal", async () => {
    const fetchImpl = fetchAnswering({ error: "Este pedido não pode ser pago.", code: "ORDER_NOT_PAYABLE" }, 409);
    const client = createCheckoutClient({ copy, fetchImpl, shortPaymentRoutes: ROUTES });

    expect(await client.payDifference!({ orderId: "o1", method: "PIX" })).toEqual({
      ok: false,
      error: "Este pedido não pode ser pago.",
      code: "ORDER_NOT_PAYABLE",
    });
  });

  it("is on the unbound client too, at the default routes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: "FAILED" }));
    const { result } = renderHook(() => useCheckoutClientApi(), {
      wrapper: ({ children }) => <CheckoutCopyProvider copy={PT_BR_CHECKOUT_COPY}>{children}</CheckoutCopyProvider>,
    });

    await result.current.requestShortRefund?.("o1");

    expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/checkout/orders/o1/short-refund");
    fetchSpy.mockRestore();
  });
});

const pixOrder = (input: CreateOrderRequest): CreateOrderResult => ({ ok: true, data: orderFor(input.method, { orderId: "o-short" }) });
const normalized = (node: HTMLElement): string => (node.textContent ?? "").replace(/\s+/g, " ");

/** A stubbed client that answers `/status` short, with the two wired acts on it. */
function wiredClient() {
  const base = stubClient();
  const getStatusDetail = vi.fn(async () => ({ ok: true as const, data: { status: "FAILED" as const, shortfall: SHORT } }));
  const payDifference = vi.fn(async (input: { orderId: string; method: "PIX" | "CARD" }) => ({
    ok: true as const,
    data: orderFor(input.method, { orderId: input.orderId }),
  }));
  const requestShortRefund = vi.fn(async () => ({
    ok: true as const,
    data: { status: "FAILED" as const, shortfall: { ...SHORT, resolution: "REFUNDED" as const } },
  }));
  return { ...base, getStatusDetail, payDifference, requestShortRefund };
}

/** Pick Pix, with the bar ready to press. */
async function choosePix(): Promise<void> {
  fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
  await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
}

/** Pick Pix, press the bar, and let the pane's first poll answer. */
async function payByPix(): Promise<void> {
  await choosePix();
  await pressBar();
}

/** Press the bar and let the pane's first poll answer. */
async function pressBar(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(screen.getByTestId("list-pay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS + 3000);
  });
  vi.useRealTimers();
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("option C with no host port: the client's own wire", () => {
  it("'Pagar R$ 13,80' raises the balance order of the order on screen", async () => {
    const client = wiredClient();
    const createOrder = vi.fn(async (input: CreateOrderRequest) => pixOrder(input));
    renderList({ config: onPageStore(), client: client as never, createOrder });

    await payByPix();
    fireEvent.click(await screen.findByTestId("payment-short-pay"));
    await choosePix();
    await waitFor(() => expect(normalized(screen.getByTestId("list-pay"))).toContain("R$ 13,80"));
    await pressBar();

    expect(client.payDifference).toHaveBeenCalledWith({ orderId: "o-short", method: "PIX" });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("'Cancelar e receber' asks the client for the refund and shows its answer", async () => {
    const client = wiredClient();
    renderList({ config: onPageStore(), client: client as never, createOrder: async (input) => pixOrder(input) });

    await payByPix();
    fireEvent.click(await screen.findByTestId("payment-short-refund"));

    expect(normalized(await screen.findByTestId("payment-short-refunded"))).toContain("Devolvemos R$ 6,90");
    expect(client.requestShortRefund).toHaveBeenCalledWith("o-short");
  });
});
