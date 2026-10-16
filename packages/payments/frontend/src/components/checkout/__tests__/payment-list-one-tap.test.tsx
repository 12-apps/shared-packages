// @vitest-environment jsdom
/**
 * FUT-3611 — the list's half of "Pedir em 1 toque" and of "the last method
 * used comes preselected".
 *
 * `lastMethod` chooses Pix for a buyer who paid with Pix last (picking creates
 * nothing, so nothing is raised); `armedCharge` starts the card's 5-second bar
 * by itself once the saved card is chosen — once, and never for a card the
 * buyer would still have to type; `chargeFooter` draws the host's opt-out under
 * Cancelar and hands it the bar's own cancel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { preselection } from "../list/choice";
import { ARMED_WINDOW_MS } from "../list/list-face";
import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, handOffStore, listFlow, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;

function recordingCreateOrder() {
  return vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the last online method used comes preselected", () => {
  const rows = [
    { method: "PIX" as const, disabled: false },
    { method: "CARD" as const, disabled: false },
  ];

  it("chooses Pix for a buyer who paid with Pix last, even with a saved card", () => {
    expect(preselection(rows, [SAVED_VISA], false, "PIX")).toEqual({ choice: { kind: "online", method: "PIX" }, selection: null });
  });

  it("keeps the saved-card rule for a card, and for no history", () => {
    expect(preselection(rows, [SAVED_VISA], false, "CARD")?.selection).toBe("vault-1");
    expect(preselection(rows, [SAVED_VISA], false, null)?.selection).toBe("vault-1");
    expect(preselection(rows, [], false, "CARD")).toBeNull();
  });

  it("does not choose Pix at a store that does not offer it, nor for a buyer back from a refused card", () => {
    expect(preselection([{ method: "CARD", disabled: false }], [SAVED_VISA], false, "PIX")?.choice).toEqual({ kind: "online", method: "CARD" });
    expect(preselection(rows, [SAVED_VISA], true, "PIX")?.choice).toEqual({ kind: "online", method: "CARD" });
  });

  it("shows Pix chosen with nothing raised", async () => {
    const createOrder = recordingCreateOrder();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder, list: { lastMethod: "PIX" } });
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
    expect(screen.getByTestId("list-pay").textContent).toContain("Gerar Pix");
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe("armedCharge — the checkout 1-tap opened", () => {
  it("starts the 5-second bar by itself on the saved card, and charges when it fills", async () => {
    const createOrder = recordingCreateOrder();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder, list: { armedCharge: true } });
    await waitFor(() => expect(screen.getByTestId("list-charge-bar").textContent).toBe("Pagando R$ 27,00 no Visa final 4242…"));
    expect(createOrder).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(createOrder.mock.calls[0]?.[0].method).toBe("CARD");
  });

  it("Cancelar sends nothing, leaves the buyer on the list, and the bar does not start again", async () => {
    const createOrder = recordingCreateOrder();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder, list: { armedCharge: true } });
    await waitFor(() => expect(screen.getByTestId("list-charge-cancel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("list-charge-cancel"));
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS * 2);
    expect(createOrder).not.toHaveBeenCalled();
    expect(screen.queryByTestId("list-charge-bar")).toBeNull();
    expect(screen.getByTestId("list-pay").textContent).toContain("Pagar");
  });

  it("never starts for a buyer with no saved card, nor at a hand-off store", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderList({ config: onPageStore(), client: stubClient([]), list: { armedCharge: true } });
    await waitFor(() => expect(screen.getByTestId("list-pay")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    expect(screen.queryByTestId("list-charge-bar")).toBeNull();
    cleanup();
    renderList({ config: handOffStore(), client: stubClient([SAVED_VISA]), list: { armedCharge: true } });
    await waitFor(() => expect(screen.getByTestId("list-pay")).toBeTruthy());
    expect(screen.queryByTestId("list-charge-bar")).toBeNull();
  });

  it("never fires on a card other than the one the consent named", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { armedCharge: true, armedCardId: "another-card" } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    expect(screen.queryByTestId("list-charge-bar")).toBeNull();
  });

  it("never fires once the step has been open longer than the armed window — a held checkout pays by a tap", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Held by the host until well past the window, then released.
    const { rerender } = renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { armedCharge: true, hold: { action: "Pagar", reason: "Escolha o horário." } } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await vi.advanceTimersByTimeAsync(ARMED_WINDOW_MS + 1_000);
    rerender(listFlow({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { armedCharge: true } }));
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByTestId("list-charge-bar")).toBeNull();
    expect(screen.getByTestId("list-pay").textContent).toContain("Pagar");
  });

  it("does not fire again after Cancelar, however the buyer comes back to the card", async () => {
    const createOrder = recordingCreateOrder();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder, list: { armedCharge: true } });
    await waitFor(() => expect(screen.getByTestId("list-charge-cancel")).toBeTruthy());
    fireEvent.click(screen.getByTestId("list-charge-cancel"));
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(radio("list-option-CARD"));
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS * 2);
    expect(screen.queryByTestId("list-charge-bar")).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("draws the host's footer under Cancelar while the bar counts, handing it the bar's cancel", async () => {
    const createOrder = recordingCreateOrder();
    const optOut = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      createOrder,
      list: {
        armedCharge: true,
        chargeFooter: (cancel) => (
          <button type="button" onClick={() => { cancel(); optOut(); }}>
            Cancelar e desativar a compra em 1 toque
          </button>
        ),
      },
    });
    const link = await screen.findByRole("button", { name: "Cancelar e desativar a compra em 1 toque" });
    fireEvent.click(link);
    expect(optOut).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS * 2);
    expect(createOrder).not.toHaveBeenCalled();
    expect(screen.queryByTestId("list-charge-footer")).toBeNull();
  });
});
