/**
 * FUT-3591 — the one list's rules, as pure functions (`../list/choice.ts`):
 * which rows the chain offers, what comes chosen, and why the button waits.
 */
import { describe, expect, it } from "vitest";

import { NEW_CARD } from "../../../card";
import { actionLabel, blockedReason, onlineRows, preselection } from "../list/choice";
import { cpfHolds, cpfProvider, topCpfField } from "../list/top-cpf";
import { PT_BR_PAYMENT_LIST_COPY as COPY } from "../list/pt-BR";
import type { CheckoutChainLink, CheckoutCustomerField } from "../types";

const VISA = { id: "v1", brand: "Visa", last4: "4242", expMonth: 1, expYear: 2040, holder: "A" };
const CPF: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };
const ALL = { handOff: false, offered: null, cardUnavailable: false };

describe("the online rows", () => {
  it("are Pix and card, in that order, for a store charging on our page — the wallets are not rows (FUT-3685)", () => {
    expect(onlineRows(ALL).map((row) => row.method)).toEqual(["PIX", "CARD"]);
  });

  it("are the single hand-off row for a store finishing on its own page", () => {
    expect(onlineRows({ ...ALL, handOff: true })).toEqual([{ method: "HAND_OFF", disabled: false }]);
  });

  it("draw a card this browser cannot take as disabled", () => {
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

/** A chain member as the list reads it: its name and what it asks of the buyer. */
function link(displayName: string, customerSchema?: CheckoutCustomerField[]): CheckoutChainLink {
  return { provider: displayName.toLowerCase(), displayName, tokenization: "PUBLIC_KEY", publicKey: null, mockTokenization: true, methods: ["PIX", "CARD"], customerSchema };
}

describe("the CPF at the top (FUT-3685)", () => {
  const cardOnly: CheckoutCustomerField[] = [{ key: "taxId", type: "CPF", required: true, methods: ["CARD"] }];
  const input = { arrivedWith: undefined, taxIdOnFile: false, revealed: false };

  it("is asked when ANY offered method needs it — the union, not the chosen row (R2)", () => {
    const chain = [link("PagBank", cardOnly)];
    expect(topCpfField({ ...input, chain, methods: ["PIX"] })).toBeNull();
    expect(topCpfField({ ...input, chain, methods: ["PIX", "CARD"] })).toMatchObject({ key: "taxId", required: true });
  });

  it("is asked when a chain member declares nothing (read as CPF required), and not when none asks", () => {
    expect(topCpfField({ ...input, chain: [link("PagBank")], methods: ["PIX"] })).not.toBeNull();
    expect(topCpfField({ ...input, chain: [link("Stone", [])], methods: ["PIX", "CARD"] })).toBeNull();
  });

  it("is not asked of a buyer who arrived with a valid one, nor one on file — until revealed, and then optional", () => {
    const chain = [link("PagBank", [CPF])];
    expect(topCpfField({ ...input, chain, methods: ["CARD"], arrivedWith: { taxId: "529.982.247-25" } })).toBeNull();
    expect(topCpfField({ ...input, chain, methods: ["CARD"], taxIdOnFile: true })).toBeNull();
    expect(topCpfField({ ...input, chain, methods: ["CARD"], taxIdOnFile: true, revealed: true })).toMatchObject({ required: false });
  });

  it("holds only a method whose chain needs it, unless a typed CPF is not valid (E3)", () => {
    const chain = [link("PagBank", cardOnly)];
    const top = topCpfField({ ...input, chain, methods: ["PIX", "CARD"] });
    expect(cpfHolds(top, {}, chain, "CARD")).toBe(true);
    expect(cpfHolds(top, {}, chain, "PIX")).toBe(false);
    expect(cpfHolds(top, { taxId: "123" }, chain, "PIX")).toBe(true);
    expect(cpfHolds(top, { taxId: "529.982.247-25" }, chain, "CARD")).toBe(false);
    expect(cpfHolds(null, {}, chain, "CARD")).toBe(false);
  });

  it("names the provider that asks for it (T3), else the chain head", () => {
    expect(cpfProvider([link("Stone", []), link("PagBank", [CPF])], ["CARD"])).toBe("PagBank");
    expect(cpfProvider([link("Stone", [])], ["CARD"])).toBe("Stone");
    expect(COPY.buyer.cpfHint("PagBank")).toBe("o PagBank pede para pagar pelo app");
    expect(COPY.buyer.cpfHint("InfinitePay")).toBe("a InfinitePay pede para pagar pelo app");
  });

  it("never holds a door choice: the bar's reason is the host's (R3)", () => {
    const door = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: () => undefined };
    expect(
      blockedReason({ copy: COPY, hold: null, choice: { kind: "door", id: "cash" }, door, asked: [CPF], buyer: {}, selection: null, cardIsComplete: false }),
    ).toBeNull();
  });
});

describe("the list's words (FUT-3685, T5–T8)", () => {
  it("are the contract's, word for word", () => {
    expect(COPY.wallets).toEqual({ heading: "Pagamento rápido", googlePay: "Pagar com Google Pay", applePay: "Pagar com Apple Pay", or: "ou escolha como pagar" });
    expect(COPY.onlineHeading).toBe("Pagar agora, pelo app");
    expect(COPY.pix).toEqual({ label: "Pix", hint: "Gera o código para copiar e colar" });
    expect(COPY.card.label).toBe("Cartão de crédito");
    expect(COPY.card.hintNew).toBe("Digite os dados do cartão");
    expect(COPY.buyer.cpf).toBe("CPF");
    expect(COPY.actions.card).toBe("Pagar");
    expect(COPY.actions.pix).toBe("Gerar Pix");
  });
});
