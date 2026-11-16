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
import { FAILURE_FACTS_TIMEOUT_MS } from "../status-facts-context";
import type { CheckoutStatusDetail } from "../status-detail";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

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
async function pressBar(extraMs = 0): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(screen.getByTestId("list-pay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS + 3000 + extraMs);
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

/** A returning buyer pays the saved Visa; the charge answers `status`, `/status` answers `detail`. */
async function payBySavedCard(status: "FAILED" | "PAID", detail: CheckoutStatusDetail | null) {
  const base = stubClient([SAVED_VISA]);
  base.charge.mockResolvedValue({ ok: true, data: { status } } as never);
  const getStatusDetail = vi.fn(async () => ({ ok: true as const, data: detail ?? { status } }));
  const client = detail === null ? base : { ...base, getStatusDetail };
  renderList({ config: onPageStore(), client: client as never, flow: { payDifference: vi.fn(), requestShortRefund: vi.fn() } });
  await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
  await pressBar();
  return { getStatusDetail, charge: base.charge };
}

describe("a card answered FAILED inside the flow (FUT-612, C2 and C7 by card)", () => {
  it("shows option C when /status states a shortfall", async () => {
    const { getStatusDetail } = await payBySavedCard("FAILED", { status: "FAILED", shortfall: { ...SHORT, paidMethod: "CARD" } });

    const open = await screen.findByTestId("payment-short-open");
    expect(normalized(open)).toContain("Já pago (Cartão)");
    expect(normalized(open)).not.toContain("Nenhum valor foi cobrado");
    expect(getStatusDetail).toHaveBeenCalledTimes(1);
  });

  it("shows the stock-gone notice when /status states one", async () => {
    await payBySavedCard("FAILED", { status: "FAILED", stockGone: { receivedCents: 2700, missing: ["Café"] } });

    const notice = await screen.findByTestId("payment-stock-gone");
    expect(normalized(notice)).toContain("Recebemos R$ 27,00, mas acabou Café");
  });

  it("keeps today's refusal beside the card, word for word, when /status states no fact", async () => {
    await payBySavedCard("FAILED", null);
    const today = (await screen.findByTestId("card-error")).textContent;
    cleanup();

    const { getStatusDetail } = await payBySavedCard("FAILED", { status: "FAILED" });
    const now = (await screen.findByTestId("card-error")).textContent;

    expect(today).toContain("nada foi cobrado");
    expect(now).toBe(today);
    expect(getStatusDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("card-error")).toBeTruthy();
  });

  it("asks /status nothing for a card answer that is not FAILED", async () => {
    const { getStatusDetail, charge } = await payBySavedCard("PAID", { status: "PAID" });

    await screen.findByTestId("payment-receipt");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(getStatusDetail).not.toHaveBeenCalled();
  });
});

/**
 * The card's POLL path (FUT-4401's late decline): the charge is accepted, then
 * the card's wait reads `/status` and finds it FAILED. `poll` is what that read
 * answers — through `getStatusDetail` when given, else the bare `getStatus`.
 */
async function acceptedThenPolled(poll: CheckoutStatusDetail | "bare") {
  const base = stubClient([SAVED_VISA]);
  base.charge.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } } as never);
  base.getStatus.mockResolvedValue({ ok: true, data: "FAILED" } as never);
  const getStatusDetail = vi.fn(async () => ({ ok: true as const, data: poll === "bare" ? { status: "FAILED" as const } : poll }));
  const client = poll === "bare" ? base : { ...base, getStatusDetail };
  renderList({ config: onPageStore(), client: client as never, flow: { payDifference: vi.fn(), requestShortRefund: vi.fn() } });
  await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
  await pressBar(5000);
  return { getStatusDetail };
}

describe("a card accepted, then polled FAILED (FUT-612 round 3)", () => {
  it("shows option C from the poll's own read, with ONE getStatusDetail call", async () => {
    const { getStatusDetail } = await acceptedThenPolled({ status: "FAILED", shortfall: { ...SHORT, paidMethod: "CARD" } });

    const open = await screen.findByTestId("payment-short-open");
    expect(normalized(open)).toContain("Já pago (Cartão)");
    expect(getStatusDetail).toHaveBeenCalledTimes(1);
  });

  it("with no fact, keeps today's late-decline refusal word for word", async () => {
    await acceptedThenPolled("bare");
    const today = (await screen.findByTestId("card-error")).textContent;
    cleanup();

    const { getStatusDetail } = await acceptedThenPolled({ status: "FAILED" });
    const now = (await screen.findByTestId("card-error")).textContent;

    expect(now).toBe(today);
    expect(getStatusDetail).toHaveBeenCalledTimes(1);
  });
});

describe("the direct-FAILED read that never answers (FUT-612 round 3)", () => {
  it("falls back to today's refusal once the read runs out of time", async () => {
    await payBySavedCard("FAILED", null);
    const today = (await screen.findByTestId("card-error")).textContent;
    cleanup();

    const base = stubClient([SAVED_VISA]);
    base.charge.mockResolvedValue({ ok: true, data: { status: "FAILED" } } as never);
    const getStatusDetail = vi.fn(() => new Promise<never>(() => undefined));
    renderList({ config: onPageStore(), client: { ...base, getStatusDetail } as never, flow: { payDifference: vi.fn() } });
    await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    // Fake timers stay on until the read's own deadline has passed: the
    // deadline is a timer created on the fake clock, mid-charge.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByTestId("list-pay"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS + 3000);
    });
    await waitFor(() => expect(getStatusDetail).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAILURE_FACTS_TIMEOUT_MS + 500);
    });
    vi.useRealTimers();

    const now = (await screen.findByTestId("card-error")).textContent;
    expect(now).toBe(today);
    expect(getStatusDetail).toHaveBeenCalledTimes(1);
  });
});
