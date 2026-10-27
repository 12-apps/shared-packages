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
import { SAVED_VISA, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

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
  cleanup();
});

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

  it("says how long each document is while a CNPJ is short, and holds the button", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.click(radio("list-option-PIX"));
    type("1122233300018");
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

describe("a CNPJ on its way out", () => {
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
});
