// @vitest-environment jsdom
/**
 * FUT-3754 — the DEBIT card, in the same list as the credit card.
 *
 * The row sits right under "Cartão de crédito" and only where the store has
 * debit on: its provider declares it AND the host gave the billing address the
 * bank checks. It types a new card (a saved card is charged as credit), and
 * paying runs the provider's 3-D Secure before the charge, which then carries
 * `funding: "DEBIT"` and the authentication id. A refused authentication
 * charges nothing and says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutBillingAddress } from "../list/types";
import type { CheckoutProviderConfig } from "../types";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const ADDRESS: CheckoutBillingAddress = {
  street: "Av. Brigadeiro Faria Lima",
  number: "1384",
  city: "São Paulo",
  regionCode: "SP",
  postalCode: "01452-002",
};

const BUYER = { name: "Ana Teste", email: "ana@example.com", phone: "11999998888", taxId: "12345678909" };

function debitStore(debit = true): CheckoutProviderConfig {
  const config = onPageStore();
  return { ...config, chain: config.chain?.map((link) => ({ ...link, debit })) };
}

function debitClient(session = "stub-3ds-session") {
  return {
    ...stubClient([SAVED_VISA]),
    threeDSecureSession: vi.fn(async () => ({
      ok: true as const,
      data: { provider: "stubpay", session, expiresAt: 1_800_000_000_000, environment: "SANDBOX" as const },
    })),
  };
}

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;

async function typeCardAndPay(): Promise<void> {
  fireEvent.change(screen.getByTestId("card-number"), { target: { value: "4000 0000 0000 2701" } });
  fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA TESTE" } });
  fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/40" } });
  fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
  await waitFor(() => expect(payButton().disabled).toBe(false));
  vi.useFakeTimers();
  fireEvent.click(payButton());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
  });
  vi.useRealTimers();
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("the debit row is offered only where debit is on", () => {
  it("draws 'Cartão de débito' right under the credit card", async () => {
    renderList({ config: debitStore(), client: debitClient(), buyer: BUYER, list: { billingAddress: ADDRESS } });
    const credit = await screen.findByTestId("list-option-CARD");
    const debit = screen.getByTestId("list-option-CARD-DEBIT");
    expect(debit.textContent).toContain("Cartão de débito");
    expect(credit.compareDocumentPosition(debit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws no debit row when the store's provider has no debit", async () => {
    renderList({ config: debitStore(false), client: debitClient(), buyer: BUYER, list: { billingAddress: ADDRESS } });
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD-DEBIT")).toBeNull());
  });

  it("draws no debit row when the host gave no billing address", async () => {
    renderList({ config: debitStore(), client: debitClient(), buyer: BUYER });
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD-DEBIT")).toBeNull());
  });
});

describe("paying by debit", () => {
  it("types a new card — no saved cards, no 'save this card'", async () => {
    renderList({ config: debitStore(), client: debitClient(), buyer: BUYER, list: { billingAddress: ADDRESS } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(radio("list-option-CARD-DEBIT"));
    await waitFor(() => expect(radio("list-option-CARD-DEBIT").checked).toBe(true));
    expect(radio("list-option-CARD").checked).toBe(false);
    expect(screen.getByTestId("card-number")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-card-vault-1")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("save-card")).toBeNull());
  });

  it("authenticates, then charges as DEBIT with the authentication id", async () => {
    const client = debitClient();
    renderList({ config: debitStore(), client, buyer: BUYER, list: { billingAddress: ADDRESS } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(radio("list-option-CARD-DEBIT"));
    await typeCardAndPay();

    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    expect(client.threeDSecureSession).toHaveBeenCalledWith({ orderId: "o-card" });
    expect(client.charge).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o-card", funding: "DEBIT", authenticationId: "stub-3ds", saveCard: false }),
    );
  });

  it("runs the provider's SDK on a real session, and charges nothing when the bank refuses", async () => {
    const authenticate3DS = vi.fn(async () => ({ status: "CHANGE_PAYMENT_METHOD" as const }));
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS });
    const client = debitClient("REAL_SESSION");
    renderList({ config: debitStore(), client, buyer: BUYER, list: { billingAddress: ADDRESS } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(radio("list-option-CARD-DEBIT"));
    await typeCardAndPay();

    await screen.findByText(/não confirmou o pagamento no débito/);
    expect(authenticate3DS).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentMethod: expect.objectContaining({ type: "DEBIT_CARD", installments: 1 }),
          billingAddress: expect.objectContaining({ postalCode: "01452002", country: "BRA" }),
        }),
      }),
    );
    expect(client.charge).not.toHaveBeenCalled();
  });

  it("charges the credit card exactly as before, with no 3-D Secure", async () => {
    const client = debitClient();
    renderList({ config: debitStore(), client, buyer: BUYER, list: { billingAddress: ADDRESS } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    expect(client.threeDSecureSession).not.toHaveBeenCalled();
    const [input] = client.charge.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(input.funding).toBeUndefined();
  });
});
