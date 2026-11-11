import { describe, expect, it } from "vitest";

import type { DiscountSchedule } from "../../engine/schedule";
import { validate } from "../discount-form-validate";
import { initialValues } from "../discount-form-values";
import { isDirty } from "../form-dirty";
import { createFormatters } from "../format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import { revealTargetOf, shownErrors, NO_SERVER_ERRORS, type RevealWatch } from "../step-effects";
import {
  countsStep,
  flowKindChanged,
  flowNext,
  flowOpen,
  flowOpenTried,
  flowRefused,
  flowToggleAll,
  initialFlow,
  stepStateOf,
  submitHold,
  type StepFlow,
} from "../step-flow";
import { errorsOfStep, missingLine, pendencias, shortNameOf, stepOfKey, STEP_OF_KEY } from "../step-keys";
import type { FormSnapshot } from "../step-summary";

/**
 * The step form's rules as rules (FUT-4477, FUT-4478): the key-to-step table,
 * the "Falta" names, the flow's moves, the pendências, the submit's hold, the
 * dirty test and what scrolls into view. Pure functions, so each case states
 * one rule of the Story.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
const { form } = copy;

const BLANK_SCHEDULE: DiscountSchedule = { windows: [{ days: [], from: "", to: "" }] };

function snapshot(overrides: Partial<FormSnapshot> = {}, values: Record<string, string> = {}): FormSnapshot {
  return {
    values: { ...initialValues(null, formatters), ...values },
    categoryIds: [],
    menuItemIds: [],
    slots: [],
    active: true,
    stackable: true,
    firstOrderOnly: false,
    scheduleEnabled: false,
    schedule: BLANK_SCHEDULE,
    ...overrides,
  };
}

describe("the key-to-step table", () => {
  it("T1: every key validate() can return belongs to exactly one step", () => {
    // Every rule broken at once, across the kinds that own them.
    const keys = new Set<string>();
    const cases: [Record<string, string>, Parameters<typeof validate>[1], boolean][] = [
      [{ kind: "COMBO", maxComboApplications: "x", comboReward: "BUNDLE_PRICE", bundlePrice: "" }, { categoryIds: [], menuItemIds: [], comboRequirements: [] }, true],
      [{ kind: "FREE_UNITS", freeUnits: "x", maxComboApplications: "x" }, { categoryIds: [], menuItemIds: [], comboRequirements: [{ quantity: 2, categoryIds: [], menuItemIds: [] }] }, true],
      [{ kind: "FIXED_AMOUNT", amountOff: "", scope: "CATEGORY" }, { categoryIds: [], menuItemIds: [], comboRequirements: [] }, true],
      [{ kind: "PERCENTAGE", percentOff: "200", scope: "ITEM", trigger: "CODE", code: "", startsAt: "31/02/2026", endsAt: "1", usageLimit: "x", perBuyerLimit: "x" }, { categoryIds: [], menuItemIds: [], comboRequirements: [] }, true],
    ];
    for (const [values, targets, enabled] of cases) {
      const errors = validate({ ...initialValues(null, formatters), ...values }, targets, formatters, copy, { enabled, schedule: { windows: [] } });
      for (const key of Object.keys(errors)) keys.add(key);
    }
    expect([...keys].sort()).toEqual(Object.keys(STEP_OF_KEY).sort());
    for (const key of keys) expect(stepOfKey(key)).not.toBeNull();
  });

  it("T2: the Story's table, key by key", () => {
    expect(["name"].map(stepOfKey)).toEqual([1]);
    expect(["kind", "freeUnitsTargets", "freeUnits", "scope"].map(stepOfKey)).toEqual([2, 2, 2, 2]);
    expect(["percentOff", "amountOff", "bundlePrice", "maxComboApplications"].map(stepOfKey)).toEqual([3, 3, 3, 3]);
    expect(["code", "startsAt", "endsAt", "schedule", "usageLimit", "perBuyerLimit"].map(stepOfKey)).toEqual([4, 4, 4, 4, 4, 4]);
  });

  it("T3: a server key the table does not list belongs to no step (the alert says it)", () => {
    expect(stepOfKey("comboRequirements")).toBeNull();
    expect(stepOfKey("type")).toBeNull();
  });
});

describe("the Falta line", () => {
  it("F1: names by key, joined by ' · '", () => {
    expect(missingLine(errorsOfStep({ name: form.nameRequired }, 1), copy)).toBe("Falta: nome");
    expect(missingLine(errorsOfStep({ code: form.codeRequired, startsAt: form.invalidDate }, 4), copy)).toBe(
      "Falta: código do cupom · data de início",
    );
  });

  it("F2: kind and schedule are named by their message", () => {
    const short = (key: string, message: string): string => shortNameOf({ key, message }, copy);
    expect(short("kind", form.comboSlotsRequired)).toBe("um grupo");
    expect(short("kind", form.invalidComboQuantity)).toBe("a quantidade");
    expect(short("kind", form.comboSlotTargetRequired)).toBe("o que entra em cada grupo");
    expect(short("kind", form.freeUnitsTargetRequired)).toBe("produtos");
    expect(short("schedule", copy.schedule.windowsRequired)).toBe("um horário");
    expect(short("schedule", copy.schedule.daysRequired)).toBe("dias e horários");
  });

  it("F3: Itens grátis with no product says 'produtos' once (kind and freeUnitsTargets dedupe)", () => {
    const errors = { kind: form.freeUnitsTargetRequired, freeUnitsTargets: form.freeUnitsTargetRequired };
    expect(errorsOfStep(errors, 2)).toHaveLength(1);
    expect(missingLine(errorsOfStep(errors, 2), copy)).toBe("Falta: produtos");
  });

  it("F4: nothing missing, no line", () => {
    expect(missingLine(errorsOfStep({ name: form.nameRequired }, 2), copy)).toBe("");
  });
});

describe("the flow", () => {
  const creating = initialFlow(false);

  it("W1: creating opens step 1, nothing reached; editing opens every step done", () => {
    expect(creating).toEqual({ cur: 1, reached: 0, tried: [], all: false });
    expect(initialFlow(true)).toEqual({ cur: 0, reached: 4, tried: [], all: false });
  });

  it("W2: three Continuar and Pronto collapse every card; step 4 always opens after step 3", () => {
    const one = flowNext(creating, 1);
    expect(one).toMatchObject({ cur: 2, reached: 1, tried: [1] });
    const three = flowNext(flowNext(one, 2), 3);
    expect(three).toMatchObject({ cur: 4, reached: 3 });
    expect(flowNext(three, 4)).toMatchObject({ cur: 0, reached: 4, tried: [1, 2, 3, 4] });
  });

  it("W3: Alterar opens that step; the next Continuar opens reached+1", () => {
    const at3: StepFlow = { cur: 4, reached: 3, tried: [1, 2, 3], all: false };
    const back = flowOpen(at3, 1);
    expect(back.cur).toBe(1);
    expect(stepStateOf(back, 4, false)).toBe("todo");
    expect(stepStateOf(back, 2, false)).toBe("done");
    expect(flowNext(back, 1).cur).toBe(4);
  });

  it("W4: a Tipo change sends steps 2–4 back and clears every tried", () => {
    const done: StepFlow = { cur: 1, reached: 4, tried: [1, 2, 3, 4], all: false };
    expect(flowKindChanged(done)).toEqual({ cur: 1, reached: 1, tried: [], all: false });
    expect(flowKindChanged(creating).reached).toBe(0);
  });

  it("W5: Ver tudo opens all, tries nothing; back returns to reached+1 or all collapsed", () => {
    const all = flowToggleAll({ cur: 3, reached: 2, tried: [1, 2], all: false });
    expect(all).toMatchObject({ all: true, tried: [1, 2] });
    expect([1, 2, 3, 4].map((step) => stepStateOf(all, step as 1, false))).toEqual(["current", "current", "current", "current"]);
    expect(flowToggleAll(all)).toMatchObject({ all: false, cur: 3 });
    expect(flowToggleAll({ ...all, reached: 4 }).cur).toBe(0);
  });

  it("W6: a pendência leaves Ver tudo and opens only its step, tried", () => {
    expect(flowOpenTried({ cur: 1, reached: 0, tried: [], all: true }, [3])).toEqual({ cur: 3, reached: 0, tried: [3], all: false });
  });

  it("W7: server errors in several steps: every one tried, the lowest opens", () => {
    expect(flowRefused({ cur: 0, reached: 4, tried: [], all: false }, [4, 2])).toMatchObject({ cur: 2, tried: [2, 4] });
  });

  it("W7b: a server error in Ver tudo leaves it and opens the lowest step at fault", () => {
    expect(flowOpenTried({ cur: 1, reached: 1, tried: [], all: true }, [4, 3])).toEqual({ cur: 3, reached: 1, tried: [3, 4], all: false });
    // The client backstop keeps Ver tudo: every step is open there already.
    expect(flowRefused({ cur: 1, reached: 1, tried: [], all: true }, [4, 3])).toMatchObject({ all: true, cur: 1 });
  });

  it("W8: a done step that is now wrong shows as error", () => {
    expect(stepStateOf({ cur: 2, reached: 3, tried: [1], all: false }, 1, true)).toBe("error");
  });
});

describe("the submit's hold, first reason wins", () => {
  const hold = (input: Parameters<typeof submitHold>[0]): string | null => submitHold(input, copy);
  it("H1: creating with a step unreached", () => {
    expect(hold({ flow: initialFlow(false), editing: false, issues: 3, dirty: true })).toBe("Termine o passo 1 para criar.");
  });
  it("H2: pendências", () => {
    const done = { cur: 0 as const, reached: 4 as const, tried: [], all: false };
    expect(hold({ flow: done, editing: false, issues: 1, dirty: true })).toBe("Resolva as pendências para criar.");
    expect(hold({ flow: done, editing: true, issues: 1, dirty: false })).toBe("Resolva as pendências para salvar.");
  });
  it("H3: editing with nothing changed; otherwise free", () => {
    const done = initialFlow(true);
    expect(hold({ flow: done, editing: true, issues: 0, dirty: false })).toBe("Nada mudou.");
    expect(hold({ flow: done, editing: true, issues: 0, dirty: true })).toBeNull();
    expect(hold({ flow: { ...initialFlow(false), all: true }, editing: false, issues: 0, dirty: true })).toBeNull();
  });
});

describe("the pendências", () => {
  it("P1: only reached or tried steps count while creating; editing and Ver tudo count every step", () => {
    const flow: StepFlow = { cur: 2, reached: 1, tried: [], all: false };
    expect([1, 2, 3, 4].filter((step) => countsStep(flow, false, step as 1))).toEqual([1]);
    expect([1, 2, 3, 4].filter((step) => countsStep(flow, true, step as 1))).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].filter((step) => countsStep({ ...flow, all: true }, false, step as 1))).toEqual([1, 2, 3, 4]);
  });

  it("P2: by step, with where it is; an empty group is said per group", () => {
    const errors = { code: form.codeRequired, name: form.nameRequired, kind: form.comboSlotTargetRequired };
    const slots = [
      { quantity: 1, categoryIds: ["c"], menuItemIds: [] },
      { quantity: 1, categoryIds: [], menuItemIds: [] },
    ];
    expect(pendencias(errors, () => true, slots, copy)).toEqual([
      { step: 1, key: "name", where: "Identificação", text: form.nameRequired },
      { step: 2, key: "kind", where: "O que entra", text: "Grupo 2: Escolha o que pode entrar em cada grupo do combo." },
      { step: 4, key: "code", where: "Regras", text: form.codeRequired },
    ]);
  });
});

describe("the messages on screen", () => {
  it("M1: only a tried step's client errors, merged with the server's", () => {
    const client = { name: form.nameRequired, code: form.codeRequired };
    const flow: StepFlow = { cur: 4, reached: 3, tried: [4], all: false };
    expect(shownErrors(client, flow, NO_SERVER_ERRORS)).toEqual({ code: form.codeRequired });
    const server = { ...NO_SERVER_ERRORS, errors: { code: "Já existe" } };
    expect(shownErrors(client, { ...flow, tried: [] }, server)).toEqual({ code: "Já existe" });
  });
});

describe("dirty", () => {
  it("D1: a value, a switch or a group's ORDER makes it dirty", () => {
    const base = snapshot({ slots: [{ quantity: 1, categoryIds: ["a"], menuItemIds: [] }, { quantity: 2, categoryIds: ["b"], menuItemIds: [] }] });
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty(base, { ...base, values: { ...base.values, name: "x" } })).toBe(true);
    expect(isDirty(base, { ...base, active: false })).toBe(true);
    expect(isDirty(base, { ...base, slots: [...base.slots].reverse() })).toBe(true);
  });

  it("D2: freeUnitsTargets is ignored, a missing key is ''", () => {
    const base = snapshot();
    expect(isDirty(base, { ...base, values: { ...base.values, freeUnitsTargets: "", schedule: "" } })).toBe(false);
  });

  it("D3: the schedule counts only while it is on; toggling it on and off is not dirty", () => {
    const base = snapshot();
    const typed = { ...base, schedule: { windows: [{ days: [0], from: "10:00", to: "11:00" }] } };
    expect(isDirty(base, typed)).toBe(false);
    expect(isDirty(base, { ...typed, scheduleEnabled: true })).toBe(true);
  });
});

describe("what scrolls into view", () => {
  const facts = (overrides: Partial<RevealWatch> = {}): RevealWatch => ({
    kind: "PERCENTAGE",
    trigger: "AUTOMATIC",
    scope: "ORDER",
    scheduleEnabled: false,
    slots: 0,
    windows: 1,
    ...overrides,
  });
  it("R1: the coupon field, the schedule, a new group, a new window, a scope's picker", () => {
    expect(revealTargetOf(facts(), facts({ trigger: "CODE" }))).toContain("total-form-field-code");
    expect(revealTargetOf(facts(), facts({ scheduleEnabled: true }))).toContain("schedule-builder");
    expect(revealTargetOf(facts({ kind: "COMBO", slots: 1 }), facts({ kind: "COMBO", slots: 2 }))).toContain("combo-slot-1");
    expect(revealTargetOf(facts({ scheduleEnabled: true }), facts({ scheduleEnabled: true, windows: 2 }))).toContain("schedule-window-1");
    expect(revealTargetOf(facts(), facts({ scope: "CATEGORY" }))).toContain("-targets");
  });
  it("R2: nothing for any other change", () => {
    expect(revealTargetOf(facts(), facts())).toBeNull();
    expect(revealTargetOf(facts({ trigger: "CODE" }), facts({ trigger: "CODE" }))).toBeNull();
    expect(revealTargetOf(facts({ scope: "CATEGORY" }), facts({ scope: "ORDER" }))).toBeNull();
  });
});
