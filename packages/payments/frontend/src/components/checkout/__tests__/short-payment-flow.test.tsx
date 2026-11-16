// @vitest-environment jsdom
/**
 * FUT-612 — option C inside `<CheckoutFlow>`, the storefront's own mount.
 *
 * The Pix pane's poll reads `/status` through `getStatusDetail` (the SAME
 * request), so a short capture's facts reach the confirmation step without the
 * host rebuilding it: the host only binds `payDifference` and
 * `requestShortRefund`. A decline still lands on today's screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { PaymentShortfall } from "@12-apps/payments-backend";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutStatusDetail } from "../status-detail";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const SHORT: PaymentShortfall = { totalCents: 2070, paidCents: 690, dueCents: 1380, paidMethod: "PIX", resolution: null };

const normalized = (node: HTMLElement): string => (node.textContent ?? "").replace(/\s+/g, " ");

/** The stubbed wire, answering `/status` with `detail` through `getStatusDetail`. */
function clientAnswering(detail: CheckoutStatusDetail) {
  const client = stubClient();
  const getStatusDetail = vi.fn(async () => ({ ok: true as const, data: detail }));
  return { client: { ...client, getStatusDetail }, getStatusDetail, getStatus: client.getStatus };
}

const pixOrder = (input: CreateOrderRequest): CreateOrderResult => ({ ok: true, data: orderFor(input.method, { orderId: "o-short" }) });

/** Pick Pix, with the bar ready to press. */
async function choosePix(): Promise<void> {
  fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
  await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
}

/** Pick Pix and press the bar; the Pix pane then polls `/status`. */
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

describe("option C in <CheckoutFlow> (FUT-612)", () => {
  it("shows the short outcome from the poll's own answer, with no extra /status read", async () => {
    const wire = clientAnswering({ status: "FAILED", shortfall: SHORT });
    renderList({
      config: onPageStore(),
      client: wire.client as never,
      createOrder: async (input) => pixOrder(input),
      flow: { payDifference: vi.fn(), requestShortRefund: vi.fn() },
    });

    await payByPix();

    const open = await screen.findByTestId("payment-short-open");
    expect(normalized(open)).toContain("Faltam R$ 13,80 para fechar o pedido");
    expect(screen.getByTestId("payment-short-pay")).toBeTruthy();
    expect(screen.getByTestId("payment-short-refund")).toBeTruthy();
    // The poll's own read carried the facts; the bare status read was never used.
    expect(wire.getStatus).not.toHaveBeenCalled();
    // ONE read: the poll's answer that settled it. The facts were known, so the
    // confirmation step asked nothing more.
    expect(wire.getStatusDetail).toHaveBeenCalledTimes(1);
  });

  it("keeps today's decline screen when the server states no fact", async () => {
    const wire = clientAnswering({ status: "FAILED" });
    renderList({ config: onPageStore(), client: wire.client as never, createOrder: async (input) => pixOrder(input) });

    await payByPix();

    const failed = await screen.findByTestId("payment-failed");
    expect(normalized(failed)).toContain("Nenhum valor foi cobrado");
    expect(screen.getByTestId("payment-retry")).toBeTruthy();
  });

  it("'Pagar R$ 13,80' goes back to Pagamento, and the bar raises the BALANCE order", async () => {
    const wire = clientAnswering({ status: "FAILED", shortfall: SHORT });
    const createOrder = vi.fn(async (input: CreateOrderRequest) => pixOrder(input));
    const payDifference = vi.fn(async (input: CreateOrderRequest) => pixOrder(input));
    renderList({ config: onPageStore(), client: wire.client as never, createOrder, flow: { payDifference } });

    await payByPix();
    fireEvent.click(await screen.findByTestId("payment-short-pay"));

    await choosePix();
    await waitFor(() => expect(normalized(screen.getByTestId("list-pay"))).toContain("R$ 13,80"));
    await pressBar();
    expect(payDifference).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("'Cancelar e receber' asks the host once and shows what it answered", async () => {
    const wire = clientAnswering({ status: "FAILED", shortfall: SHORT });
    const requestShortRefund = vi.fn(async () => ({
      ok: true as const,
      data: { status: "FAILED" as const, shortfall: { ...SHORT, resolution: "REFUNDED" as const } },
    }));
    renderList({
      config: onPageStore(),
      client: wire.client as never,
      createOrder: async (input) => pixOrder(input),
      flow: { requestShortRefund },
    });

    await payByPix();
    fireEvent.click(await screen.findByTestId("payment-short-refund"));

    const refunded = await screen.findByTestId("payment-short-refunded");
    expect(normalized(refunded)).toContain("Devolvemos R$ 6,90");
    expect(requestShortRefund).toHaveBeenCalledWith("o-short");
  });

  it("offers neither act when the host binds neither port", async () => {
    const wire = clientAnswering({ status: "FAILED", shortfall: SHORT });
    renderList({ config: onPageStore(), client: wire.client as never, createOrder: async (input) => pixOrder(input) });

    await payByPix();

    const open = await screen.findByTestId("payment-short-open");
    expect(open.querySelectorAll("button")).toHaveLength(0);
  });
});
