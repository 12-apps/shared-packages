// @vitest-environment jsdom
/**
 * FUT-4109 — debit in EVERY store type, not only where the host has an address.
 *
 * A mercado, balcão or mesa buyer has no delivery address, and the debit row
 * used to be absent there. With the host's CEP lookup, the row asks the CEP
 * and the number itself (the street only when the CEP names none), and the
 * 3-D Secure runs with what it was told.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutBillingLookup } from "../list/types";
import type { CheckoutProviderConfig } from "../types";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const BUYER = { name: "Ana Teste", email: "ana@example.com", phone: "11999998888", taxId: "12345678909" };

function debitStore(): CheckoutProviderConfig {
  const config = onPageStore();
  return { ...config, chain: config.chain?.map((link) => ({ ...link, debit: true })) };
}

function debitClient() {
  return {
    ...stubClient([SAVED_VISA]),
    threeDSecureSession: vi.fn(async () => ({
      ok: true as const,
      data: { provider: "stubpay", session: "REAL_SESSION", expiresAt: 1_800_000_000_000, environment: "SANDBOX" as const },
    })),
  };
}

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const field = (testId: string): HTMLInputElement => screen.getByTestId(testId).querySelector("input") ?? (screen.getByTestId(testId) as HTMLInputElement);

function typeCard(): void {
  fireEvent.change(screen.getByTestId("card-number"), { target: { value: "4000 0000 0000 2701" } });
  fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA TESTE" } });
  fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/40" } });
  fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
}

async function chooseDebit(lookup: CheckoutBillingLookup): Promise<void> {
  renderList({ config: debitStore(), client: debitClient(), buyer: BUYER, list: { billingLookup: lookup } });
  await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
  fireEvent.click(radio("list-option-CARD-DEBIT"));
  await waitFor(() => expect(radio("list-option-CARD-DEBIT").checked).toBe(true));
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("debit without the host's address", () => {
  it("is offered with a CEP lookup, and asks the CEP and the number inside its row", async () => {
    await chooseDebit(async () => ({ street: "Rua Augusta", city: "São Paulo", regionCode: "SP" }));
    expect(screen.getByTestId("debit-address-cep")).toBeTruthy();
    expect(screen.getByTestId("debit-address-number")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("debit-address-street")).toBeNull());
  });

  it("holds the button until the address is there, then authenticates with it", async () => {
    const authenticate3DS = vi.fn(async () => ({ status: "CHANGE_PAYMENT_METHOD" as const }));
    vi.stubGlobal("PagSeguro", { encryptCard: vi.fn(), setUp: vi.fn(), authenticate3DS });
    await chooseDebit(async () => ({ street: "Rua Augusta", city: "São Paulo", regionCode: "SP" }));
    typeCard();
    await screen.findByText("Informe o CEP e o número do endereço de cobrança");
    expect(payButton().disabled).toBe(true);

    fireEvent.change(field("debit-address-cep"), { target: { value: "01305000" } });
    fireEvent.change(field("debit-address-number"), { target: { value: "500" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(authenticate3DS).toHaveBeenCalled());
    expect(authenticate3DS).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingAddress: expect.objectContaining({ street: "Rua Augusta", number: "500", city: "São Paulo", regionCode: "SP", postalCode: "01305000" }),
        }),
      }),
    );
  });

  it("asks the street when the CEP names none", async () => {
    await chooseDebit(async () => ({ street: null, city: "Itu", regionCode: "SP" }));
    fireEvent.change(field("debit-address-cep"), { target: { value: "13300000" } });
    await screen.findByTestId("debit-address-street");
  });

  it("says so when the CEP is not found", async () => {
    await chooseDebit(async () => null);
    fireEvent.change(field("debit-address-cep"), { target: { value: "00000000" } });
    expect((await screen.findAllByText("Não achamos esse CEP. Confira os números.")).length).toBeGreaterThan(0);
  });

  it("asks nothing when the host gave the address (the entrega's)", async () => {
    renderList({
      config: debitStore(),
      client: debitClient(),
      buyer: BUYER,
      list: { billingLookup: async () => null, billingAddress: { street: "Av. Paulista", number: "1", city: "São Paulo", regionCode: "SP", postalCode: "01310-100" } },
    });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(radio("list-option-CARD-DEBIT"));
    await waitFor(() => expect(radio("list-option-CARD-DEBIT").checked).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("debit-address")).toBeNull());
  });
});

describe("the debit address is the last thing the button waits for", () => {
  it("asks the card before the address, the order they sit in", async () => {
    await chooseDebit(async () => ({ street: "Rua Augusta", city: "São Paulo", regionCode: "SP" }));
    expect(screen.getByTestId("list-blocked-reason").textContent).not.toContain("CEP");
    typeCard();
    await screen.findByText("Informe o CEP e o número do endereço de cobrança");
  });

  it("asks the CPF at the top before the address", async () => {
    renderList({ config: debitStore(), client: debitClient(), buyer: { ...BUYER, taxId: undefined }, taxIdOnFile: false, list: { billingLookup: async () => null } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(radio("list-option-CARD-DEBIT"));
    await waitFor(() => expect(radio("list-option-CARD-DEBIT").checked).toBe(true));
    typeCard();
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Digite seu CPF ou CNPJ para pagar pelo app."));
  });
});
