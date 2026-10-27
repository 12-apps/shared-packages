// @vitest-environment jsdom
/**
 * FUT-4080 — the buyer's document at the top of Pagamento takes a CNPJ.
 *
 * A buyer paying with a company card gives the card holder's CNPJ; the field
 * took 11 digits only ("Não aceita cnpj"). It now reads "CPF ou CNPJ", masks
 * a CPF up to 11 digits and a CNPJ from the 12th, checks either by its check
 * digits, and keeps plain digits — so the order, "Salvar meus dados" and the
 * charge all carry the CNPJ's fourteen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, installGoogle, onPageStore, orderFor, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

const CNPJ = "11222333000181";
const CNPJ_SHOWN = "11.222.333/0001-81";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const field = (): HTMLInputElement => {
  const node = screen.getByTestId("list-buyer-taxId");
  return (node.tagName === "INPUT" ? node : node.querySelector("input")) as HTMLInputElement;
};
const type = (value: string): void => {
  fireEvent.change(screen.getByTestId("list-buyer-taxId"), { target: { value } });
};

function recordingCreateOrder() {
  return vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  uninstallWallets();
  cleanup();
});

/** A CNPJ whose first 11 digits are, on their own, a valid CPF (`112.223.550-00`). */
const CPF_SHAPED_CNPJ = "11222355000141";

/** Type `digits` one keystroke at a time, the way a buyer does. */
function typeDigitByDigit(digits: string, upTo = digits.length): void {
  for (let n = 1; n <= upTo; n += 1) type(digits.slice(0, n));
}

describe("the document field takes a CNPJ (FUT-4080)", () => {
  it("reads 'CPF ou CNPJ', with the same words as its placeholder", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    expect(screen.getByText("CPF ou CNPJ")).toBeTruthy();
    expect(field().placeholder).toBe("CPF ou CNPJ");
  });

  it("masks a CNPJ typed digit by digit, switching masks at the 12th", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    type("11222333000");
    await waitFor(() => expect(field().value).toBe("112.223.330-00"));
    type("112.223.330-001");
    await waitFor(() => expect(field().value).toBe("11.222.333/0001"));
    type("11.222.333/000181");
    await waitFor(() => expect(field().value).toBe(CNPJ_SHOWN));
  });

  it.each([
    ["with its punctuation", CNPJ_SHOWN],
    ["as bare digits", CNPJ],
  ])("takes a CNPJ pasted %s and frees the pay button", async (_case, pasted) => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type(pasted);
    await waitFor(() => expect(field().value).toBe(CNPJ_SHOWN));
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(field().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("says how long each document is once the buyer leaves a CNPJ short, and holds the button", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type("1122233300018");
    // Not while it is typed (FUT-4106): thirteen digits may still become a CNPJ.
    fireEvent.blur(screen.getByTestId("list-buyer-taxId"));
    await screen.findByText("O CPF tem 11 dígitos, e o CNPJ, 14.");
    expect(payButton().disabled).toBe(true);
  });

  it("asks for a valid one when a CNPJ's check digits are wrong", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type("11.222.333/0001-82");
    await screen.findByText("Informe um CPF ou CNPJ válido.");
    expect(payButton().disabled).toBe(true);
  });

  it("refuses fourteen equal digits", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type("11111111111111");
    await screen.findByText("Informe um CPF ou CNPJ válido.");
    expect(payButton().disabled).toBe(true);
  });
});

describe("the focus while a CNPJ is typed", () => {
  it("stays in the field when its first 11 digits make a valid CPF, and the 14 digits land", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-CARD"));
    await screen.findByTestId("card-number");
    await act(async () => HTMLElement.prototype.focus.call(field()));
    typeDigitByDigit(CPF_SHAPED_CNPJ, 11);
    await waitFor(() => expect(field().value).toBe("112.223.550-00"));
    await waitFor(() => expect(document.activeElement).toBe(field()));
    typeDigitByDigit(CPF_SHAPED_CNPJ);
    await waitFor(() => expect(field().value).toBe("11.222.355/0001-41"));
    // A valid CNPJ cannot grow, so only now does the buyer move on to the card.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("card-number")));
  });

  it("keeps a CPF typed digit by digit in the field — it may be a CNPJ's start", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-CARD"));
    await screen.findByTestId("card-number");
    await act(async () => HTMLElement.prototype.focus.call(field()));
    typeDigitByDigit("52998224725");
    await waitFor(() => expect(field().value).toBe("529.982.247-25"));
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("goes back to the CPF mask when a CNPJ is deleted back to 11 digits", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    type(CNPJ_SHOWN);
    await waitFor(() => expect(field().value).toBe(CNPJ_SHOWN));
    type("11.222.333/0001-8");
    await waitFor(() => expect(field().value).toBe("11.222.333/0001-8"));
    type("11.222.333/000");
    await waitFor(() => expect(field().value).toBe("112.223.330-00"));
    type("112.223.330-0");
    await waitFor(() => expect(field().value).toBe("112.223.330-0"));
  });
});

describe("a CNPJ on its way out", () => {
  it("is fourteen plain digits on the Google Pay charge", async () => {
    installGoogle();
    const client = stubClient([SAVED_VISA]);
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    renderList({ config: walletStore(), client, createOrder: recordingCreateOrder(), taxIdOnFile: false, list: { totalCents: 2700 } });
    await screen.findByTestId("list-cpf");
    type(CNPJ_SHOWN);
    await waitFor(() => expect(field().value).toBe(CNPJ_SHOWN));
    const press = await screen.findByTestId("google-pay-native");
    await waitFor(() => expect(screen.queryByTestId("list-wallets-held")).toBeNull());
    fireEvent.click(press);
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
    expect(client.chargeWallet).toHaveBeenCalledWith(expect.objectContaining({ taxId: CNPJ, wallet: { type: "GOOGLE_PAY", key: "gpay-key" } }));
  });

  it("is fourteen plain digits on the order, on 'Salvar meus dados' and on the card charge", async () => {
    const createOrder = recordingCreateOrder();
    const save = vi.fn();
    const client = stubClient([SAVED_VISA]);
    renderList({ config: onPageStore(), client, createOrder, taxIdOnFile: false, saveBuyerContact: save });
    await screen.findByTestId("list-cpf");
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    type(CNPJ_SHOWN);
    await waitFor(() => expect(payButton().disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    expect(client.charge).toHaveBeenCalledWith(expect.objectContaining({ taxId: CNPJ }));
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ buyer: expect.objectContaining({ taxId: CNPJ }) }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ taxId: CNPJ })));
  });

  it("sends a host's masked pre-fill as digits too", async () => {
    const client = stubClient([SAVED_VISA]);
    renderList({ config: onPageStore(), client, taxIdOnFile: false, buyer: { name: "Ana Teste", taxId: CNPJ_SHOWN } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await waitFor(() => expect(payButton().disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    expect(client.charge).toHaveBeenCalledWith(expect.objectContaining({ taxId: CNPJ }));
  });
});

describe("a CNPJ on file", () => {
  it("names the kind on the payer line and opens masked as a CNPJ", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste", taxId: CNPJ } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => expect(screen.getByTestId("list-payer").textContent).toContain("Pagando como Ana Teste · CNPJ ✓"));
    fireEvent.click(screen.getByTestId("list-payer-change"));
    await screen.findByTestId("list-buyer-taxId");
    expect(field().value).toBe(CNPJ_SHOWN);
    expect(payButton().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Manter o documento salvo" })).toBeTruthy();
  });

  it("names the kind the host passes when it hands no digits over", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, taxIdKindOnFile: "CNPJ", buyer: { name: "Ana Teste" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => expect(screen.getByTestId("list-payer").textContent).toContain("Pagando como Ana Teste · CNPJ ✓"));
  });

  it("lets the document the host hands over win over the kind on file", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, taxIdKindOnFile: "CNPJ", buyer: { name: "Ana Teste", taxId: "52998224725" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    await waitFor(() => expect(screen.getByTestId("list-payer").textContent).toContain("Pagando como Ana Teste · CPF ✓"));
  });
});
