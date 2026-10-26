// @vitest-environment jsdom
/**
 * FUT-3999 — the paid confirmation of the one list carries no flow header.
 *
 * In list mode the host's own stepper is the chrome around every step the
 * buyer sees. The flow hid its header on Pagamento only, so once the card was
 * paid the old checkout's "Voltar · Etapa 3 de 3 · Confirmação" (and, on a
 * computer, its back link and three-dot stepper) came back INSIDE the host's
 * Pagamento card: a step header nested in a step, counting three steps the
 * host never showed, with a "Voltar" into a payment that already happened.
 *
 * Since FUT-4028 the flow draws no header anywhere; these keep the paid
 * confirmation honest about it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const HEADER_TEST_IDS = ["checkout-back", "checkout-step-progress", "checkout-stepper"] as const;

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

/** A returning buyer pays the saved Visa through the list and lands on the paid confirmation. */
async function payThroughTheList(): Promise<void> {
  renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
  const pay = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
  await waitFor(() => expect(pay().disabled).toBe(false));
  vi.useFakeTimers();
  fireEvent.click(pay());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
  });
  vi.useRealTimers();
  await screen.findByTestId("payment-receipt");
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cleanup();
});

describe("the one list's paid confirmation (FUT-3999)", () => {
  it.each([
    ["a phone", 390],
    ["a computer", 1280],
  ])("draws no Voltar, no 'Etapa N de M' and no stepper on %s", async (_label, width) => {
    frameWidth(width);
    await payThroughTheList();
    expect(screen.getByText("Pedido confirmado")).toBeTruthy();
    await waitFor(() => {
      for (const testId of HEADER_TEST_IDS) expect(screen.queryByTestId(testId)).toBeNull();
      expect(screen.queryByText(/Etapa \d+ de \d+/)).toBeNull();
    });
  });
});
