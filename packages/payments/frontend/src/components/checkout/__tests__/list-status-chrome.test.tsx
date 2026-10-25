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
 * The method tabs (no list) keep the header on their confirmation, unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutFlow } from "../checkout-flow";
import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import { CheckoutNavigateProvider } from "../navigate-context";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { CheckoutClient } from "../transport";
import type { CreateOrderResult } from "../types";
import { SAVED_VISA, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

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

/** The method tabs, no list: a one-click buyer with a saved card is charged and lands on the confirmation. */
async function payThroughTheTabs(): Promise<void> {
  const client = stubClient([SAVED_VISA]);
  client.getStatus.mockImplementation(async () => ({ ok: true as const, data: "PAID" as never }));
  render(
    <CheckoutClientProvider client={client as unknown as CheckoutClient}>
      <CheckoutNavigateProvider navigate={vi.fn()}>
        <CheckoutFlow
          copy={PT_BR_CHECKOUT_VIEW_COPY}
          cart={{ empty: false, totalLabel: "R$ 27,00", totalItems: 2 }}
          createOrder={async (): Promise<CreateOrderResult> => ({ ok: true, data: orderFor("CARD") })}
          onExitToMenu={vi.fn()}
          providerConfig={onPageStore()}
          tenantSlug="loja-1"
          taxIdOnFile
          oneClick
        />
      </CheckoutNavigateProvider>
    </CheckoutClientProvider>,
  );
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

describe("the method tabs' confirmation keeps its header", () => {
  it("draws Voltar and 'Etapa 3 de 3' on a phone", async () => {
    frameWidth(390);
    await payThroughTheTabs();
    expect(screen.getByTestId("checkout-back")).toBeTruthy();
    expect(screen.getByTestId("checkout-step-progress").textContent).toMatch(/Etapa 3 de 3/);
  });

  it("draws Voltar and the stepper on a computer", async () => {
    frameWidth(1280);
    await payThroughTheTabs();
    expect(screen.getByTestId("checkout-back")).toBeTruthy();
    expect(screen.getByTestId("checkout-stepper")).toBeTruthy();
  });
});
