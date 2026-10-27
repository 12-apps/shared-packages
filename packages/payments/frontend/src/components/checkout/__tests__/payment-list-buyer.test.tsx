// @vitest-environment jsdom
/**
 * FUT-3685 — the CPF asked ONCE, at the top of Pagamento, above the wallets.
 *
 *  - It shows when ANY online method or wallet the list offers needs it under
 *    the chain rule — the union, never the chosen row (R2) — and the buyer
 *    arrived without one (E1). Its hint names the provider that asks.
 *  - It holds the online rows' button and the wallet buttons with the bar's
 *    reason (E3); a door row is never held by it (R3).
 *  - With a CPF on file there is no field but a payer line whose "Alterar"
 *    reveals it at the top — never a Dados step (E2, K6, R9).
 *  - The hand-off provider's mobile stays inside its own row (K4); a card
 *    typed now holds "Pagar" until its fields are good.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import type { CheckoutCustomerField } from "../types";
import { handOffStore, installGoogle, onPageStore, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

// A raised order is parked in `sessionStorage` (FUT-1140); one test's must not resume in the next.
beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  uninstallWallets();
  cleanup();
});

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const reason = (): string | null => screen.queryByTestId("list-blocked-reason")?.textContent ?? null;
const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

function door(): CheckoutDoorOption {
  return { id: "cash", label: "Dinheiro", hint: "Diga se precisa de troco", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
}

/** Only the CARD needs a CPF at this store; Pix does not. */
const CPF_FOR_CARD: CheckoutCustomerField[] = [{ key: "taxId", type: "CPF", required: true, methods: ["CARD"] }];

describe("the CPF at the top of Pagamento (E1)", () => {
  it("is asked before anything is chosen, above the rows, with the provider's reason under 'CPF ou CNPJ'", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    const top = await screen.findByTestId("list-cpf");
    expect(within(top).getByText("CPF ou CNPJ")).toBeTruthy();
    expect(within(top).getByText("o PagBank pede para pagar pelo app")).toBeTruthy();
    expect(within(top).getByLabelText(/^CPF ou CNPJo PagBank pede para pagar pelo app/)).toBeTruthy();
    expect(within(top).getByPlaceholderText("CPF ou CNPJ")).toBeTruthy();
    expect(within(top).getByLabelText("Salvar meus dados para a próxima compra")).toBeTruthy();
    expect(top.compareDocumentPosition(screen.getByTestId("list-option-PIX")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Never inside a row any more.
    fireEvent.click(radio("list-option-CARD"));
    await waitFor(() => expect(within(screen.getByTestId("list-option-CARD")).queryByTestId("list-buyer-taxId")).toBeNull());
    expect(screen.getAllByTestId("list-buyer-taxId")).toHaveLength(1);
  });

  it("is the union over what the list offers, not the chosen row (R2)", async () => {
    // Pix asks nothing; the card does — so the field is there with Pix chosen.
    renderList({ config: onPageStore({ customerSchema: CPF_FOR_CARD }), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    expect(screen.getByTestId("list-buyer-taxId")).toBeTruthy();
    // …and holds only the method that needs it.
    await waitFor(() => expect(payButton().disabled).toBe(false));
    fireEvent.click(radio("list-option-CARD"));
    await waitFor(() => expect(reason()).toBe("Digite seu CPF ou CNPJ para pagar pelo app."));
  });

  it("is asked for a wallet alone: a store whose only CPF-needing way to pay is the card behind Google Pay", async () => {
    installGoogle();
    renderList({ config: walletStore(["GOOGLE_PAY"], { customerSchema: CPF_FOR_CARD, methods: ["PIX", "CARD"] }), client: stubClient([]), taxIdOnFile: false, list: { totalCents: 2700 } });
    await screen.findByTestId("list-wallets");
    expect(screen.getByTestId("list-buyer-taxId")).toBeTruthy();
  });

  it("is not asked at a store whose chain needs no CPF", async () => {
    renderList({ config: onPageStore({ customerSchema: [] }), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-cpf")).toBeNull());
  });

  it("is not asked of a buyer who arrived with a valid one", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, buyer: { name: "Ana", taxId: "529.982.247-25" } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-cpf")).toBeNull());
  });

  it("says the CPF has 11 digits once the buyer leaves it short, and holds an online row's button for it (E3)", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type("list-buyer-taxId", "123");
    // Not while it is typed (FUT-4106): the bar's reason says why the button waits.
    fireEvent.blur(screen.getByTestId("list-buyer-taxId"));
    await screen.findByText("O CPF tem 11 dígitos, e o CNPJ, 14.");
    expect(payButton().disabled).toBe(true);
    expect(reason()).toBe("Digite seu CPF ou CNPJ para pagar pelo app.");
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("moves the focus to the card number when the CPF is complete and a new card is chosen", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-CARD"));
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("card-number")));
    expect(reason()).toBe("Preencha os dados do cartão.");
  });

  it("never holds a door row (R3)", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, list: { door: [door()] } });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(payButton().textContent).toContain("Enviar pedido");
    // A half-typed CPF does not hold the door either: nothing online is being paid.
    type("list-buyer-taxId", "123");
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("holds the wallet buttons with the bar's reason until the CPF is good (E3)", async () => {
    installGoogle();
    renderList({ config: walletStore(), client: stubClient([]), taxIdOnFile: false, list: { totalCents: 2700 } });
    const native = await screen.findByTestId("google-pay-native");
    await waitFor(() => expect(native.getAttribute("aria-disabled")).toBe("true"));
    expect(screen.getByTestId("list-wallets-held").textContent).toBe("Digite seu CPF ou CNPJ para pagar pelo app.");
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(screen.getByTestId("google-pay-native").getAttribute("aria-disabled")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-wallets-held")).toBeNull());
  });
});

describe("a CPF on file (E2)", () => {
  it("shows no field, but the payer line — and 'Alterar' reveals the CPF at the top, focused, never a Dados step", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => expect(screen.queryByTestId("list-cpf")).toBeNull());
    expect(screen.getByTestId("list-payer").textContent).toContain("Pagando como Ana Teste · CPF ✓");
    fireEvent.click(screen.getByTestId("list-payer-change"));
    const field = await screen.findByTestId("list-buyer-taxId");
    await waitFor(() => expect(document.activeElement).toBe(field));
    await waitFor(() => expect(screen.queryByTestId("list-payer")).toBeNull());
    // Still Pagamento: no Dados form, no "Continuar".
    expect(screen.getByTestId("payment-list")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("checkout-continue")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("buyer-cpf")).toBeNull());
  });

  it("opens holding the CPF the host passed, masked; a new one must be valid (K6, U3)", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste", taxId: "52998224725" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(screen.getByTestId("list-payer-change"));
    const field = (await screen.findByTestId("list-buyer-taxId")) as HTMLInputElement;
    const input = field.tagName === "INPUT" ? field : (field.querySelector("input") as HTMLInputElement);
    expect(input.value).toBe("529.982.247-25");
    expect(payButton().disabled).toBe(false);
    type("list-buyer-taxId", "111.111.111-1");
    await waitFor(() => expect(payButton().disabled).toBe(true));
    expect(reason()).toBe("Digite seu CPF ou CNPJ para pagar pelo app.");
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("left empty keeps the saved CPF: pay stays live — the host passed none (review round 2)", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(screen.getByTestId("list-payer-change"));
    await screen.findByTestId("list-buyer-taxId");
    expect(payButton().disabled).toBe(false);
    type("list-buyer-taxId", "529.982.247-25");
    type("list-buyer-taxId", "");
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("'Manter o documento salvo' closes the field, drops what was typed and brings the payer line back", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(screen.getByTestId("list-payer-change"));
    await screen.findByTestId("list-buyer-taxId");
    type("list-buyer-taxId", "123");
    await waitFor(() => expect(payButton().disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Manter o documento salvo" }));
    await screen.findByTestId("list-payer");
    await waitFor(() => expect(screen.queryByTestId("list-cpf")).toBeNull());
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("shows the payer line with nothing chosen, and hides it for a door row (C3)", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" }, list: { door: [door()] } });
    await screen.findByTestId("list-payer");
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(screen.queryByTestId("list-payer")).toBeNull());
  });
});

describe("remembering the CPF", () => {
  it("saves a CPF typed at the top, with the consent — and nothing for a CPF on file left alone", async () => {
    const save = vi.fn();
    const first = renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, saveBuyerContact: save });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(payButton().disabled).toBe(false));
    fireEvent.click(payButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ taxId: "52998224725" })));
    first.unmount();
    // The raised Pix is parked for a resume; the next checkout must not pick it up.
    window.sessionStorage.clear();

    const again = vi.fn();
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" }, saveBuyerContact: again });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => expect(payButton().disabled).toBe(false));
    fireEvent.click(payButton());
    await screen.findByTestId("list-pix");
    // A CPF on file nobody touched: nothing new to remember.
    expect(again).not.toHaveBeenCalled();
  });
});

describe("what stays inside a row", () => {
  it("asks the hand-off store's mobile inside its row, in its own words (K4)", async () => {
    renderList({ config: handOffStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-cpf")).toBeNull());
    fireEvent.click(radio("list-option-HAND_OFF"));
    const row = screen.getByTestId("list-option-HAND_OFF");
    expect(within(row).getByLabelText(/^Celular \(a InfinitePay pede para pagar pelo app\)/)).toBeTruthy();
    expect(reason()).toBe("Digite seu celular para pagar pelo app.");
    type("list-buyer-phone", "1198765");
    await screen.findByText("O celular precisa de DDD e 9 dígitos.");
    type("list-buyer-phone", "(11) 98765-4321");
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(payButton().textContent).toBe("Ir para a InfinitePayR$ 27,00");
  });

  it("holds Pagar for a card typed now until number, name, MM/AA and CVV are all good, and says so", async () => {
    renderList({ config: onPageStore(), client: stubClient([]) });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-CARD"));
    expect(payButton().disabled).toBe(true);
    expect(reason()).toBe("Preencha os dados do cartão.");
    type("card-number", "4111 1111 1111 1111");
    type("card-holder", "ANA TESTE");
    type("card-expiry", "12/40");
    await waitFor(() => expect(payButton().disabled).toBe(true));
    type("card-cvv", "123");
    await waitFor(() => expect(payButton().disabled).toBe(false));
    await waitFor(() => expect(screen.queryByTestId("list-blocked-reason")).toBeNull());
  });
});
