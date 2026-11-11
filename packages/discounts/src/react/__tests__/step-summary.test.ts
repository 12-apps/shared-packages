import { describe, expect, it } from "vitest";

import type { WireTargetGroup } from "../api";
import { initialValues } from "../discount-form-values";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import { doneLines, resumoSentence, ruleChips, stripChips, type FormSnapshot, type SummaryWorld } from "../step-summary";

import HARNESS_TARGETS from "./fixtures/harness-targets.json";

/**
 * What each done card, the "Resumo" and the status strip say (FUT-4475, "Step
 * card states", "Resumo", "Chrome"), on the harness seed: Bebidas / Lanches,
 * Café / Suco / X-Salada. `Intl` writes a no-break space after "R$"; the cases
 * compare with a plain one.
 */

const formatters = createFormatters("pt-BR", "BRL");
const world: SummaryWorld = { copy: PT_BR_DISCOUNTS_WEB_COPY, formatters, groups: HARNESS_TARGETS as WireTargetGroup[] };
const plain = (text: string): string => text.replace(/\u00a0/g, " ");

function snapshot(values: Record<string, string>, overrides: Partial<FormSnapshot> = {}): FormSnapshot {
  return {
    values: { ...initialValues(null, formatters), ...values },
    categoryIds: [],
    menuItemIds: [],
    slots: [],
    active: true,
    stackable: true,
    firstOrderOnly: false,
    scheduleEnabled: false,
    schedule: { windows: [{ days: [], from: "", to: "" }] },
    ...overrides,
  };
}

const COMBO = snapshot(
  { name: "2 Lanches por R$ 30", kind: "COMBO", comboReward: "BUNDLE_PRICE", bundlePrice: "30,00" },
  { slots: [{ quantity: 2, categoryIds: ["cat-lanches"], menuItemIds: [] }] },
);
const FREE = snapshot(
  { name: "Leve 3", kind: "FREE_UNITS", freeUnits: "1", maxComboApplications: "2" },
  { slots: [{ quantity: 3, categoryIds: [], menuItemIds: ["item-cafe", "item-suco"] }] },
);
const PERCENT = snapshot({ name: "10% em Bebidas", kind: "PERCENTAGE", percentOff: "10", scope: "CATEGORY" }, { categoryIds: ["cat-bebidas"] });

describe("done lines", () => {
  it("S1: step 1 is '{Tipo} · {Nome}'", () => {
    expect(doneLines(1, COMBO, world)).toEqual({ answer: "Combo · 2 Lanches por R$ 30", detail: "" });
  });

  it("S2: step 2 per kind", () => {
    expect(doneLines(2, COMBO, world)).toEqual({ answer: "Leve 2 de Lanches", detail: "O combo leva 2 itens em 1 grupo." });
    expect(doneLines(2, FREE, world)).toEqual({ answer: "Leve 3, pague 2", detail: "Café, Suco" });
    expect(doneLines(2, PERCENT, world).answer).toBe("Categorias: Bebidas");
    expect(doneLines(2, snapshot({ kind: "FIXED_AMOUNT", scope: "ORDER" }), world).answer).toBe("Pedido inteiro");
    expect(doneLines(2, snapshot({ kind: "FIXED_AMOUNT", scope: "ITEM" }), world).answer).toBe("Produtos: …");
  });

  it("S3: step 3 per kind; with no cart preview the cap line stands alone", () => {
    expect(plain(doneLines(3, COMBO, world).answer)).toBe("Preço fechado · R$ 30,00");
    // The seed carries no prices, so there is no "Cliente paga" line to lead.
    expect(doneLines(3, COMBO, world).detail).toBe("Combos por pedido: quantas vezes couber");
    expect(doneLines(3, FREE, world).answer).toBe("Vezes por pedido: 2 por pedido");
    expect(doneLines(3, PERCENT, world).answer).toBe("Desconto (%): 10%");
    expect(plain(doneLines(3, snapshot({ kind: "FIXED_AMOUNT", amountOff: "20,00" }), world).answer)).toBe("Valor do desconto: R$ 20,00");
  });

  it("S4: step 4 is the rule chips, then the usual line", () => {
    expect(doneLines(4, COMBO, world)).toEqual({
      answer: "Automático · Sem prazo · Todos os dias · Sem limites · Acumulável · Ativo",
      detail: "Já vem com o comum. Toque para mudar.",
    });
  });

  it("S5: an empty group reads '…', and the free counts never go below zero", () => {
    const empty = snapshot({ kind: "COMBO" }, { slots: [{ quantity: 1, categoryIds: [], menuItemIds: [] }] });
    expect(doneLines(2, empty, world).answer).toBe("Leve 1 de …");
    expect(doneLines(2, snapshot({ kind: "FREE_UNITS", freeUnits: "9" }, { slots: [{ quantity: 3, categoryIds: [], menuItemIds: [] }] }), world).answer).toBe(
      "Leve 3, pague 0",
    );
  });
});

describe("the Resumo", () => {
  it("R1: the sentence per kind", () => {
    expect(plain(resumoSentence(COMBO, world))).toBe("Leve 2 de Lanches por R$ 30,00.");
    expect(resumoSentence(FREE, world)).toBe("Leve 3, pague 2 em Café ou Suco.");
    expect(resumoSentence(PERCENT, world)).toBe("10% de desconto em Bebidas.");
    expect(resumoSentence(snapshot({ kind: "PERCENTAGE", percentOff: "15" }), world)).toBe("15% de desconto no pedido inteiro.");
  });

  it("R2: no product, no ' em …'; no value yet, the value's clause is dropped, never '…'", () => {
    expect(resumoSentence(snapshot({ kind: "FREE_UNITS", freeUnits: "1" }, { slots: [{ quantity: 3, categoryIds: [], menuItemIds: [] }] }), world)).toBe(
      "Leve 3, pague 2.",
    );
    expect(resumoSentence(snapshot({ kind: "PERCENTAGE" }), world)).toBe("Desconto no pedido inteiro.");
    expect(resumoSentence(snapshot({ kind: "FIXED_AMOUNT", scope: "CATEGORY" }, { categoryIds: ["cat-bebidas"] }), world)).toBe(
      "Desconto em Bebidas.",
    );
    const noPrice = snapshot({ kind: "COMBO", comboReward: "BUNDLE_PRICE" }, { slots: COMBO.slots });
    expect(plain(resumoSentence(noPrice, world))).toBe("Leve 2 de Lanches.");
  });

  it("R3: the rule chips in order, with every variant", () => {
    const rules = snapshot(
      { kind: "PERCENTAGE", trigger: "CODE", code: "BEMVINDO10", startsAt: "2026-12-01", minSubtotal: "20,00", usageLimit: "100", perBuyerLimit: "1" },
      {
        firstOrderOnly: true,
        stackable: false,
        active: false,
        scheduleEnabled: true,
        schedule: { windows: [{ days: [0, 1, 2, 3, 4], from: "11:00", to: "14:00" }] },
      },
    );
    expect(ruleChips(rules, world).map(plain)).toEqual([
      "Cupom BEMVINDO10",
      "A partir de 01/12/2026",
      "De segunda a sexta 11:00–14:00",
      "Pedido mín. R$ 20,00 · 100 usos · 1 por cliente",
      "Só 1ª compra",
      "Exclusiva",
      "Pausado",
    ]);
    expect(ruleChips(snapshot({ trigger: "CODE" }), world)[0]).toBe("Cupom sem código");
  });

  it("R4: Só 1ª compra is never said for a combo", () => {
    expect(ruleChips({ ...COMBO, firstOrderOnly: true }, world)).not.toContain("Só 1ª compra");
  });
});

describe("the status strip", () => {
  it("C1: the chips of an edited plain rule, paused in amber", () => {
    const rule = snapshot({ kind: "PERCENTAGE", startsAt: "2026-12-01", endsAt: "2026-12-31", usageLimit: "5" }, { active: false, scheduleEnabled: true });
    expect(stripChips(rule, world)).toEqual([
      { id: "active", label: "Pausado", warn: true },
      { id: "activation", label: "Automático", warn: false },
      { id: "period", label: "01/12/2026 a 31/12/2026 · dias e horários", warn: false },
      { id: "stacking", label: "Acumulável", warn: false },
      { id: "limits", label: "Com limites", warn: false },
      { id: "firstOrder", label: "Qualquer cliente", warn: false },
    ]);
  });

  it("C2: a combo has no first-purchase chip", () => {
    expect(stripChips(COMBO, world).map((chip) => chip.id)).toEqual(["active", "activation", "period", "stacking", "limits"]);
  });
});
