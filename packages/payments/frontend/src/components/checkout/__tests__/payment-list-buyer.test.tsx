// @vitest-environment jsdom
/**
 * FUT-3591 #4 and #5 — what the chosen online option asks for, inside it.
 *
 * The CPF (PagBank) or the mobile (InfinitePay) is asked FIRST, above the card
 * fields, and only from a buyer who has none: a complete CPF moves the focus
 * to "Número do cartão". A card typed now keeps Pagar held until all four
 * fields are good, saying so under the button.
 */
import { afterEach, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { handOffStore, onPageStore, renderList, stubClient } from "./list-harness";

afterEach(() => cleanup());

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const reason = (): string | null => screen.queryByTestId("list-blocked-reason")?.textContent ?? null;
const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

/** A buyer who arrived with no CPF, at a store whose chain requires one. */
async function newBuyerOnCard(): Promise<void> {
  renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, buyer: { name: "Ana Teste" } });
  await screen.findByTestId("payment-list");
  fireEvent.click(radio("list-option-CARD"));
}

describe("the CPF, asked first and only when missing", () => {
  it("opens the CPF ABOVE the card fields inside the card option, named for the provider", async () => {
    await newBuyerOnCard();
    const option = screen.getByTestId("list-option-CARD");
    const cpf = within(option).getByTestId("list-buyer-taxId");
    const number = within(option).getByTestId("card-number");
    expect(cpf.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(option).getByLabelText(/^CPF \(o PagBank pede para pagar pelo app\)/)).toBeTruthy();
  });

  it("says the CPF has 11 digits while it is short, and holds the button for it", async () => {
    await newBuyerOnCard();
    type("list-buyer-taxId", "123");
    await screen.findByText("O CPF tem 11 dígitos.");
    expect(payButton().disabled).toBe(true);
    expect(reason()).toBe("Digite seu CPF para pagar pelo app.");
  });

  it("moves the focus to the card number when the CPF is complete", async () => {
    await newBuyerOnCard();
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("card-number")));
    await waitFor(() => expect(screen.queryByText("O CPF tem 11 dígitos.")).toBeNull());
    expect(reason()).toBe("Preencha os dados do cartão.");
  });

  it("asks it inside Pix too, with nothing to move the focus to", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    expect(within(screen.getByTestId("list-option-PIX")).getByTestId("list-buyer-taxId")).toBeTruthy();
    type("list-buyer-taxId", "529.982.247-25");
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("never asks a buyer whose CPF is on file", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => expect(screen.queryByTestId("list-buyer-taxId")).toBeNull());
    expect(payButton().disabled).toBe(false);
  });

  it("asks the hand-off store's mobile instead, in its own words", async () => {
    renderList({ config: handOffStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-HAND_OFF"));
    expect(screen.getByLabelText(/^Celular \(a InfinitePay pede para pagar pelo app\)/)).toBeTruthy();
    expect(reason()).toBe("Digite seu celular para pagar pelo app.");
    type("list-buyer-phone", "1198765");
    await screen.findByText("O celular precisa de DDD e 9 dígitos.");
    type("list-buyer-phone", "(11) 98765-4321");
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(payButton().textContent).toBe("Ir para a InfinitePayR$ 27,00");
  });
});

describe("a card typed now", () => {
  it("holds Pagar until number, name, MM/AA and CVV are all good, and says so", async () => {
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
