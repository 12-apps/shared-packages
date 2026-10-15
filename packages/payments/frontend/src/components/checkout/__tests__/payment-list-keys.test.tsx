// @vitest-environment jsdom
/**
 * FUT-3591 code review round 2:
 *
 *  - the saved-card chips are ONE Tab stop; the arrows, Home and End move and
 *    select, as a radio group's do;
 *  - a Google Pay choice survives a moment without a price (the host
 *    re-pricing after the credit toggles): the row stays, its button waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutProviderConfig } from "../types";
import { SAVED_MASTER, SAVED_VISA, listFlow, onPageStore, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  delete (window as { google?: unknown }).google;
  cleanup();
});

describe("the saved-card chips", () => {
  it("are one Tab stop: only the checked chip is tabbable", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, SAVED_MASTER]) });
    await waitFor(() => {
      expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByTestId("list-card-vault-1").getAttribute("tabindex")).toBe("0");
      expect(screen.getByTestId("list-card-vault-2").getAttribute("tabindex")).toBe("-1");
      expect(screen.getByTestId("list-card-new").getAttribute("tabindex")).toBe("-1");
    });
  });

  it("move and select with the arrows, Home and End, wrapping at the ends", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, SAVED_MASTER]) });
    const first = await screen.findByTestId("list-card-vault-1");
    await waitFor(() => expect(first.getAttribute("aria-checked")).toBe("true"));
    const press = async (key: string, expected: string) => {
      // From the group's one Tab stop — the chip the keyboard is on.
      const stop = document.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? first;
      fireEvent.keyDown(stop, { key });
      await waitFor(() => {
        const chip = screen.getByTestId(expected);
        expect(chip.getAttribute("aria-checked")).toBe("true");
        expect(chip.getAttribute("tabindex")).toBe("0");
        expect(document.activeElement).toBe(chip);
      });
    };
    await press("ArrowRight", "list-card-vault-2");
    await press("ArrowDown", "list-card-new");
    await press("ArrowRight", "list-card-vault-1");
    await press("ArrowLeft", "list-card-new");
    await press("Home", "list-card-vault-1");
    await press("End", "list-card-new");
    await press("ArrowUp", "list-card-vault-2");
  });

  it("draw the rows' 2px primary ring on the chip the keyboard is on", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, SAVED_MASTER]) });
    const first = await screen.findByTestId("list-card-vault-1");
    await waitFor(() => expect(first.getAttribute("aria-checked")).toBe("true"));
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByTestId("list-card-vault-2");
    await waitFor(() => expect(second.classList.contains("Mui-focusVisible")).toBe(true));
    const style = getComputedStyle(second);
    expect(style.outlineStyle || style.outline).toContain("solid");
    expect(getComputedStyle(first).outlineStyle || "").not.toContain("solid");
  });
});

function walletStore(): CheckoutProviderConfig {
  const base = onPageStore();
  const head = base.chain?.[0];
  if (!head) throw new Error("the store has a chain head");
  return { ...base, chain: [{ ...head, wallets: ["GOOGLE_PAY"], googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1" } }] };
}

function installGoogle(): void {
  class PaymentsClient {
    isReadyToPay = async () => ({ result: true });
    createButton = ({ onClick }: { onClick: () => void }) => {
      const button = document.createElement("button");
      button.setAttribute("data-testid", "google-pay-native");
      button.addEventListener("click", onClick);
      return button;
    };
    loadPaymentData = vi.fn(async () => ({ paymentMethodData: { tokenizationData: { token: "k" } } }));
  }
  (window as { google?: unknown }).google = { payments: { api: { PaymentsClient } } };
}

describe("Google Pay while the host re-prices", () => {
  it("keeps the choice and holds the button until the price returns", async () => {
    installGoogle();
    const host = { config: walletStore(), client: stubClient() };
    const { rerender } = renderList({ ...host, list: { totalCents: 2700 } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    await screen.findByTestId("google-pay-native");

    rerender(listFlow({ ...host, list: {} }));
    await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(true));
    expect(radio("list-option-GOOGLE_PAY").checked).toBe(true);

    rerender(listFlow({ ...host, list: { totalCents: 2500 } }));
    await screen.findByTestId("google-pay-native");
    expect(radio("list-option-GOOGLE_PAY").checked).toBe(true);
  });
});
