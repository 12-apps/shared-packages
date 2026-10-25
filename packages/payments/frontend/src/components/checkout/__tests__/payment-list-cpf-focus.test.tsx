// @vitest-environment jsdom
/**
 * FUT-3995 — choosing Pix or Cartão with no CPF takes the buyer to the CPF.
 *
 *  - A buyer with no valid CPF who taps an online row whose chain needs it
 *    gets the focus in the CPF at the top of Pagamento, scrolled into view.
 *  - A buyer with a CPF on file, or one the row's chain does not need, keeps
 *    the focus where it was.
 *  - A preselected option at load moves neither the focus nor the scroll.
 *  - A choice made from the keyboard (the arrows walking the group, Space)
 *    keeps the focus in the radio group.
 *  - Tapping the online row already chosen (a preselected last method) takes
 *    the buyer to the CPF too: it is a deliberate tap, not the load.
 *  - A door row (Dinheiro, Maquininha) is paid at the door and moves nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutBillingAddress, CheckoutDoorOption } from "../list/types";
import type { CheckoutCustomerField, CheckoutProviderConfig } from "../types";
import { onPageStore, renderList, stubClient } from "./list-harness";

const scrolled = vi.fn();
const nativeScroll = Element.prototype.scrollIntoView;

// A raised order is parked in `sessionStorage` (FUT-1140); one test's must not resume in the next.
beforeEach(() => {
  window.sessionStorage.clear();
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled;
});
afterEach(() => {
  Element.prototype.scrollIntoView = nativeScroll;
  cleanup();
});

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
/** The CPF's own `<input>` — the test id may sit on the input or on its wrapper. */
const cpfInput = (): HTMLInputElement => {
  const field = screen.getByTestId("list-buyer-taxId");
  return field.tagName === "INPUT" ? (field as HTMLInputElement) : (field.querySelector("input") as HTMLInputElement);
};
/** A tap or a click: a pointer goes down, then the radio is clicked. */
const tap = (target: HTMLElement): void => {
  fireEvent.pointerDown(target);
  fireEvent.click(target);
};
/** The arrows walking the radio group: a key goes down, then the radio is checked. */
const arrowTo = (target: HTMLElement): void => {
  fireEvent.keyDown(target, { key: "ArrowDown" });
  fireEvent.click(target);
};

/** Space on the focused radio: a key goes down, then the browser clicks the radio. */
const spaceOn = (target: HTMLElement): void => {
  target.focus();
  fireEvent.keyDown(target, { key: " ", code: "Space" });
  fireEvent.keyUp(target, { key: " ", code: "Space" });
  fireEvent.click(target);
};

/** The billing address the bank checks — without it no debit row is drawn. */
const ADDRESS: CheckoutBillingAddress = { street: "Av. Brigadeiro Faria Lima", number: "1384", city: "São Paulo", regionCode: "SP", postalCode: "01452-002" };

/** A store whose provider has debit on, so "Cartão de débito" is drawn under the credit card. */
function debitStore(): CheckoutProviderConfig {
  const config = onPageStore();
  return { ...config, chain: config.chain?.map((link) => ({ ...link, debit: true })) };
}

/** A client that can open a 3-D Secure session — the debit row is drawn only beside one. */
function debitClient() {
  return {
    ...stubClient([]),
    threeDSecureSession: vi.fn(async () => ({
      ok: true as const,
      data: { provider: "stubpay", session: "stub-3ds-session", expiresAt: 1_800_000_000_000, environment: "SANDBOX" as const },
    })),
  };
}

function door(overrides: Partial<CheckoutDoorOption> = {}): CheckoutDoorOption {
  return { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: "Diga se precisa de troco.", onSend: vi.fn(), ...overrides };
}

/** Only the CARD needs a CPF at this store; Pix does not. */
const CPF_FOR_CARD: CheckoutCustomerField[] = [{ key: "taxId", type: "CPF", required: true, methods: ["CARD"] }];

describe("choosing an online row with no CPF (FUT-3995)", () => {
  it("focuses the CPF at the top and scrolls it into view when Pix is tapped", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    tap(radio("list-option-PIX"));
    await waitFor(() => expect(document.activeElement).toBe(cpfInput()));
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts).toContain(screen.getByTestId("list-cpf"));
  });

  it("focuses the CPF at the top when Cartão de crédito is tapped", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    tap(radio("list-option-CARD"));
    await waitFor(() => expect(document.activeElement).toBe(cpfInput()));
    expect(scrolled).toHaveBeenCalled();
  });

  it("focuses the CPF at the top when Cartão de débito is tapped", async () => {
    renderList({ config: debitStore(), client: debitClient(), taxIdOnFile: false, list: { billingAddress: ADDRESS } });
    await screen.findByTestId("list-cpf");
    const debit = radio("list-option-CARD-DEBIT");
    tap(debit);
    await waitFor(() => expect(debit.checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(cpfInput()));
    expect(scrolled.mock.contexts).toContain(screen.getByTestId("list-cpf"));
  });

  it("focuses it when the buyer taps the online row already chosen — a preselected last method", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, list: { lastMethod: "PIX" } });
    await screen.findByTestId("list-cpf");
    const pix = radio("list-option-PIX");
    await waitFor(() => expect(pix.checked).toBe(true));
    expect(document.activeElement).toBe(document.body);
    tap(pix);
    await waitFor(() => expect(document.activeElement).toBe(cpfInput()));
    expect(pix.checked).toBe(true);
    expect(scrolled.mock.contexts).toContain(screen.getByTestId("list-cpf"));
  });

  it("focuses it for a CPF typed that is not valid", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.change(screen.getByTestId("list-buyer-taxId"), { target: { value: "111.111.111-1" } });
    tap(radio("list-option-PIX"));
    await waitFor(() => expect(document.activeElement).toBe(cpfInput()));
  });
});

describe("the focus stays where it was (FUT-3995)", () => {
  it("for a buyer with a CPF on file who taps Pix", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: true, buyer: { name: "Ana Teste" } });
    await screen.findByTestId("payment-list");
    const pix = radio("list-option-PIX");
    tap(pix);
    await waitFor(() => expect(pix.checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("once the CPF typed is valid", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    fireEvent.change(screen.getByTestId("list-buyer-taxId"), { target: { value: "529.982.247-25" } });
    const pix = radio("list-option-PIX");
    tap(pix);
    await waitFor(() => expect(pix.checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("for a row whose chain asks no CPF", async () => {
    renderList({ config: onPageStore({ customerSchema: CPF_FOR_CARD }), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    const pix = radio("list-option-PIX");
    tap(pix);
    await waitFor(() => expect(pix.checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("for a choice made from the keyboard — the arrows walking the group", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    const pix = radio("list-option-PIX");
    arrowTo(pix);
    await waitFor(() => expect(pix.checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(scrolled).not.toHaveBeenCalled();
    // A tap after the keys is the buyer's own choice again.
    tap(radio("list-option-CARD"));
    await waitFor(() => expect(document.activeElement).toBe(cpfInput()));
  });

  it("for a choice made from the keyboard — Space on a radio of the group", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    const card = radio("list-option-CARD");
    spaceOn(card);
    await waitFor(() => expect(card.checked).toBe(true));
    expect(document.activeElement).toBe(card);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("for Space on the online row already chosen", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, list: { lastMethod: "PIX" } });
    await screen.findByTestId("list-cpf");
    const pix = radio("list-option-PIX");
    await waitFor(() => expect(pix.checked).toBe(true));
    spaceOn(pix);
    expect(pix.checked).toBe(true);
    expect(document.activeElement).toBe(pix);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it.each([
    ["Dinheiro", "cash"],
    ["Maquininha", "reader"],
  ])("for a door row — %s is paid at the door", async (label, id) => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, list: { door: [door({ id, label })] } });
    await screen.findByTestId("list-cpf");
    const row = radio(`list-door-${id}`);
    tap(row);
    await waitFor(() => expect(row.checked).toBe(true));
    // Tapped again, chosen: still nothing.
    tap(row);
    expect(document.activeElement).toBe(document.body);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("for an option preselected at load: neither the focus nor the scroll moves", async () => {
    renderList({ config: onPageStore(), client: stubClient([]), taxIdOnFile: false, list: { lastMethod: "PIX" } });
    await screen.findByTestId("list-cpf");
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("for a sole option chosen at load", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient([]), taxIdOnFile: false });
    await screen.findByTestId("list-cpf");
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(scrolled).not.toHaveBeenCalled();
  });
});
