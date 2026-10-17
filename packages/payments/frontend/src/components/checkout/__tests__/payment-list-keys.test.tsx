// @vitest-environment jsdom
/**
 * FUT-3591 code review round 2:
 *
 *  - the saved-card chips are ONE Tab stop; the arrows, Home and End move and
 *    select, as a radio group's do;
 *  - a wallet survives a moment without a price (the host re-pricing after
 *    the credit toggles): its place stays, held PLAINLY — disabled, no
 *    spinner, "Atualizando o valor…" under it (FUT-3685: a button in the
 *    block above the list, no longer a row).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutProviderConfig } from "../types";
import { SAVED_MASTER, SAVED_VISA, listFlow, onPageStore, renderList, stubClient } from "./list-harness";


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

describe("a wallet while the host re-prices", () => {
  it("keeps its place, held plainly with 'Atualizando o valor…', until the price returns", async () => {
    installGoogle();
    const host = { config: walletStore(), client: stubClient() };
    const { rerender } = renderList({ ...host, list: { totalCents: 2700 } });
    await screen.findByTestId("google-pay-native");

    rerender(listFlow({ ...host, list: {} }));
    await waitFor(() => {
      expect(screen.getByTestId("list-wallet-held")).toBeTruthy();
      expect(screen.getByTestId("list-wallet-buttons").getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByText("Atualizando o valor…")).toBeTruthy();
    });
    await waitFor(() => expect(screen.queryByTestId("google-pay-native")).toBeNull());

    rerender(listFlow({ ...host, list: { totalCents: 2500 } }));
    await screen.findByTestId("google-pay-native");
    await waitFor(() => expect(screen.queryByText("Atualizando o valor…")).toBeNull());
  });
});
