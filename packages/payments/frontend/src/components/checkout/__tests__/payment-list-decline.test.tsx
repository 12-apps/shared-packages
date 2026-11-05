// @vitest-environment jsdom
/**
 * FUT-4401 — a refused card leaves the buyer with a message and a way on.
 *
 * Every ending of the card submit — a refusal at once (whatever `retriable`
 * says), a refusal after the charge was accepted, a charge that never got an
 * answer, the wait running out — leaves a sentence on screen and a live
 * control. A refusal is said BESIDE the card form, never by swapping the list
 * for a status screen, and what the buyer typed stays except the CVV, which is
 * flagged when the refusal is about the card's data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { ChargeOutcome, CreateOrderRequest, CreateOrderResult } from "../types";
import { onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const field = (testId: string): HTMLInputElement => {
  const node = screen.getByTestId(testId);
  return (node instanceof HTMLInputElement ? node : node.querySelector("input")) as HTMLInputElement;
};

const INVALID_CARD_SENTENCE = "O banco recusou o cartão. Confira o número, a validade e o código de segurança.";

function recordingCreateOrder() {
  return vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));
}

const scrolled = vi.fn();
const focusedOn = vi.spyOn(HTMLElement.prototype, "focus");

beforeEach(() => {
  window.sessionStorage.clear();
  scrolled.mockReset();
  focusedOn.mockClear();
  Element.prototype.scrollIntoView = scrolled;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** A buyer with no saved card, the card typed in full. */
async function typedCard(client = stubClient(), createOrder = recordingCreateOrder()) {
  renderList({ config: onPageStore(), client, createOrder });
  const cardRow = await screen.findByTestId("list-option-CARD-radio");
  fireEvent.click(cardRow);
  await waitFor(() => expect(screen.getByTestId("card-number")).toBeTruthy());
  fireEvent.change(field("card-number"), { target: { value: "4111 1111 1111 1111" } });
  fireEvent.change(field("card-holder"), { target: { value: "ANA TESTE" } });
  fireEvent.change(field("card-expiry"), { target: { value: "12/40" } });
  fireEvent.change(field("card-cvv"), { target: { value: "123" } });
  await waitFor(() => expect(payButton().disabled).toBe(false));
  return { client, createOrder };
}

/** Press Pagar and let the 5-second bar fill. */
async function press(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(payButton());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
  });
  vi.useRealTimers();
}

function refusedWith(outcome: Omit<ChargeOutcome, "status">) {
  const client = stubClient();
  client.charge.mockResolvedValue({ ok: true, data: { status: "FAILED", ...outcome } } as never);
  return client;
}

/** The refusal is on screen, in view and focused, beside the card form — and the list never gave way. */
async function refusedBesideTheCard(sentence: string): Promise<void> {
  const alert = await screen.findByTestId("card-error");
  expect(alert.textContent).toContain(sentence);
  await waitFor(() => expect(screen.queryByTestId("payment-status")).toBeNull());
  expect(screen.getByTestId("card-number")).toBeTruthy();
  expect(scrolled).toHaveBeenCalled();
  // Given the focus, so a screen reader announces it (spied: jsdom focus is timing-bound).
  expect(focusedOn.mock.contexts).toContain(screen.getByTestId("charge-failure"));
}

describe("a refusal at once is said beside the card (FUT-4401)", () => {
  it("20007 — INVALID_CARD, retriable:false — keeps the order, the card but the CVV, and flags the CVV", async () => {
    const { client, createOrder } = await typedCard(refusedWith({ declineReason: "INVALID_CARD", retriable: false }));
    await press();

    await refusedBesideTheCard(INVALID_CARD_SENTENCE);
    expect(field("card-number").value).toBe("4111 1111 1111 1111");
    expect(field("card-holder").value).toBe("ANA TESTE");
    expect(field("card-expiry").value).toBe("12/40");
    expect(field("card-cvv").value).toBe("");
    expect(field("card-cvv").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Informe o CVV.")).toBeTruthy();

    // The pay button comes back: the CVV typed again, it is live, and the
    // corrected card goes against the SAME order — the server kept it open.
    expect(payButton().getAttribute("aria-busy")).not.toBe("true");
    fireEvent.change(field("card-cvv"), { target: { value: "321" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    client.charge.mockResolvedValue({ ok: true, data: { status: "PAID" } } as never);
    await press();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(2));
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(client.charge).toHaveBeenLastCalledWith(expect.objectContaining({ orderId: "o-card" }));
  });

  it("retriable:true — the same card may be tried again on the same order", async () => {
    const { client, createOrder } = await typedCard(refusedWith({ declineReason: "CARD_DECLINED", retriable: true }));
    await press();

    await refusedBesideTheCard("Seu banco não autorizou o pagamento e nada foi cobrado.");
    // Not a card-data refusal: nothing is flagged, though the CVV is not kept.
    expect(field("card-cvv").value).toBe("");
    expect(field("card-cvv").getAttribute("aria-invalid")).not.toBe("true");
    await waitFor(() => expect(screen.queryByText("Informe o CVV.")).toBeNull());
    fireEvent.change(field("card-cvv"), { target: { value: "123" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    await press();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(2));
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("retriable unset — the server closed the order, so the next press raises a fresh one", async () => {
    const { client, createOrder } = await typedCard(refusedWith({ declineReason: "CARD_DECLINED" }));
    await press();

    await refusedBesideTheCard("Seu banco não autorizou o pagamento e nada foi cobrado.");
    fireEvent.change(field("card-cvv"), { target: { value: "123" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    await press();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(2));
    expect(createOrder).toHaveBeenCalledTimes(2);
  });

  it("a refusal with no classification still says the card did not pay", async () => {
    await typedCard(refusedWith({}));
    await press();

    await refusedBesideTheCard("O pagamento não foi aprovado e nada foi cobrado.");
    fireEvent.change(field("card-cvv"), { target: { value: "123" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });
});

describe("the other endings of the card submit (FUT-4401)", () => {
  it("a refusal after the charge was accepted ends the wait beside the card, on a fresh order next", async () => {
    const client = stubClient();
    client.charge.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } } as never);
    client.getStatus.mockResolvedValue({ ok: true, data: "FAILED" } as never);
    const { createOrder } = await typedCard(client);
    await press();

    await refusedBesideTheCard("O pagamento não foi aprovado e nada foi cobrado.");
    fireEvent.change(field("card-cvv"), { target: { value: "123" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    client.charge.mockResolvedValue({ ok: true, data: { status: "PAID" } } as never);
    await press();
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
  });

  it("a charge that failed without an answer (!ok) is brought into view and focused, and the button stays", async () => {
    const client = stubClient();
    client.charge.mockResolvedValue({ ok: false, error: "Não conseguimos falar com o pagamento." } as never);
    await typedCard(client);
    await press();

    await refusedBesideTheCard("Não conseguimos falar com o pagamento.");
    // Nothing was refused, so the card is untouched and the button live at once.
    expect(field("card-cvv").value).toBe("123");
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("the wait running out ends on the confirmation screen's own ending, with a way back", async () => {
    const client = stubClient();
    client.charge.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } } as never);
    await typedCard(client);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    await screen.findByTestId("card-processing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(91_000);
    });
    vi.useRealTimers();

    await screen.findByTestId("payment-awaiting-timeout");
    expect(screen.getByTestId("payment-awaiting-timeout").textContent).toContain("não pague de novo");
    await waitFor(() => expect(screen.queryByTestId("card-poll-timeout")).toBeNull());
    const back = screen.getByTestId("payment-back-to-menu") as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    expect(screen.getByTestId("payment-check-again")).toBeTruthy();
  });
});
