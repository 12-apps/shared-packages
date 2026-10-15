/**
 * FUT-3591 — the one list's rules, as pure functions (`../list/choice.ts`):
 * which rows the chain offers, what comes chosen, and why the button waits.
 */
import { describe, expect, it } from "vitest";

import { NEW_CARD } from "../../../card";
import { actionLabel, blockedReason, onlineRows, preselection } from "../list/choice";
import { PT_BR_PAYMENT_LIST_COPY as COPY } from "../list/pt-BR";
import type { CheckoutCustomerField } from "../types";

const VISA = { id: "v1", brand: "Visa", last4: "4242", expMonth: 1, expYear: 2040, holder: "A" };
const CPF: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };
const ALL = { handOff: false, offered: null, cardUnavailable: false, googlePayReady: true };

describe("the online rows", () => {
  it("are Pix, card and Google Pay, in that order, for a store charging on our page", () => {
    expect(onlineRows(ALL).map((row) => row.method)).toEqual(["PIX", "CARD", "GOOGLE_PAY"]);
  });

  it("are the single hand-off row for a store finishing on its own page", () => {
    expect(onlineRows({ ...ALL, handOff: true })).toEqual([{ method: "HAND_OFF", disabled: false }]);
  });

  it("draw a card this browser cannot take as disabled, with no Google Pay beside it", () => {
    expect(onlineRows({ ...ALL, cardUnavailable: true })).toEqual([
      { method: "PIX", disabled: false },
      { method: "CARD", disabled: true },
    ]);
  });

  it("follow what the chain declares", () => {
    expect(onlineRows({ ...ALL, offered: ["PIX"] }).map((row) => row.method)).toEqual(["PIX"]);
  });
});

describe("what comes chosen", () => {
  const rows = onlineRows(ALL);

  it("is the card and the head of the saved list", () => {
    expect(preselection(rows, [VISA], false)).toEqual({ choice: { kind: "online", method: "CARD" }, selection: "v1" });
  });

  it("is nothing without a saved card", () => {
    expect(preselection(rows, [], false)).toBeNull();
  });

  it("is the card with NO saved card selected after a refusal, or the fields when there is none", () => {
    expect(preselection(rows, [VISA], true)).toEqual({ choice: { kind: "online", method: "CARD" }, selection: null });
    expect(preselection(rows, [], true)).toEqual({ choice: { kind: "online", method: "CARD" }, selection: NEW_CARD });
  });

  it("is nothing at a store whose card this browser cannot take", () => {
    expect(preselection(onlineRows({ ...ALL, cardUnavailable: true }), [VISA], false)).toBeNull();
  });
});

describe("why the button waits", () => {
  const base = {
    copy: COPY,
    hold: null,
    choice: { kind: "online", method: "CARD" } as const,
    door: undefined,
    asked: [] as CheckoutCustomerField[],
    buyer: {},
    selection: "v1",
    cardIsComplete: false,
  };

  it("says the host's hold first, whatever is chosen", () => {
    expect(blockedReason({ ...base, hold: "Escolha o horário no passo 2." })).toBe("Escolha o horário no passo 2.");
  });

  it("asks for a choice, then the CPF, then the card, in the prototype's order", () => {
    expect(blockedReason({ ...base, choice: null })).toBe("Escolha como pagar.");
    expect(blockedReason({ ...base, asked: [CPF], selection: NEW_CARD })).toBe("Digite seu CPF para pagar pelo app.");
    expect(blockedReason({ ...base, selection: null })).toBe("Escolha o cartão.");
    expect(blockedReason({ ...base, selection: NEW_CARD })).toBe("Preencha os dados do cartão.");
    expect(blockedReason({ ...base, selection: NEW_CARD, cardIsComplete: true })).toBeNull();
    expect(blockedReason(base)).toBeNull();
  });

  it("lets a door option speak for itself — and a null reason means it can send", () => {
    const door = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: () => undefined };
    expect(blockedReason({ ...base, choice: { kind: "door", id: "cash" }, door })).toBeNull();
    expect(blockedReason({ ...base, choice: { kind: "door", id: "cash" }, door: { ...door, blocked: "Diga se precisa de troco." } })).toBe("Diga se precisa de troco.");
  });
});

describe("the button's verb", () => {
  it("names what the press will do", () => {
    expect(actionLabel(COPY, null, undefined, null)).toBe("Escolha como pagar");
    expect(actionLabel(COPY, { kind: "online", method: "CARD" }, undefined, null)).toBe("Pagar");
    expect(actionLabel(COPY, { kind: "online", method: "PIX" }, undefined, null)).toBe("Gerar Pix");
    expect(actionLabel(COPY, { kind: "online", method: "GOOGLE_PAY" }, undefined, null)).toBe("Pagar com Google Pay");
    expect(actionLabel(COPY, { kind: "online", method: "HAND_OFF" }, undefined, "InfinitePay")).toBe("Ir para a InfinitePay");
    expect(actionLabel(COPY, { kind: "online", method: "HAND_OFF" }, undefined, null)).toBe("Ir para o pagamento");
  });
});
