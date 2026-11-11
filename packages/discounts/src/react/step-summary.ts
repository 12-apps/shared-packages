import type { DiscountSchedule } from "../engine/schedule";
import type { ComboRequirement } from "../engine/types";

import { toBasisPoints, toCents, type WireTargetGroup } from "./api";
import { comboPreviewOf } from "./combo-preview";
import { comboPreviewLines } from "./combo-preview-lines";
import { comboUnits } from "./combo-slot-builder";
import { fill, type CompleteDiscountsWebCopy } from "./copy";
import { isIsoDay } from "./date-field";
import { comboRewardOf, typeAndScopeFor, type DiscountKind } from "./form-kind";
import type { DiscountsFormatters } from "./format";
import { formatDays } from "./schedule-summary";

/**
 * What each step card says once answered, the "Resumo" sentence and its rule
 * chips, and the status strip (FUT-4475, "Step card states", "Resumo",
 * "Chrome"): pure functions of the form as it is NOW, so a later edit is read
 * back at once and every line is a rule a unit test states.
 */

/** Everything the form holds, strings and the state beside them. */
export interface FormSnapshot {
  values: Readonly<Record<string, string>>;
  categoryIds: readonly string[];
  menuItemIds: readonly string[];
  slots: readonly ComboRequirement[];
  active: boolean;
  stackable: boolean;
  firstOrderOnly: boolean;
  scheduleEnabled: boolean;
  schedule: DiscountSchedule;
}

export interface SummaryWorld {
  copy: CompleteDiscountsWebCopy;
  formatters: DiscountsFormatters;
  groups: readonly WireTargetGroup[];
}

export interface DoneLines {
  answer: string;
  detail: string;
}

function kindOfSnapshot(form: FormSnapshot): DiscountKind {
  const kind = form.values.kind ?? "PERCENTAGE";
  return kind === "FIXED_AMOUNT" || kind === "COMBO" || kind === "FREE_UNITS" ? kind : "PERCENTAGE";
}

/** Target names by id, categories and products alike. */
function namer(world: SummaryWorld): (ids: readonly string[]) => string[] {
  const names = new Map(world.groups.flatMap((group) => group.targets.map((target) => [target.id, target.name] as const)));
  return (ids) => ids.map((id) => names.get(id) ?? id);
}

/** "5 de Tradicionais ou Fitness + 2 de Bebidas", or "…" before any group. */
function comboParts(form: FormSnapshot, world: SummaryWorld): string {
  const { summary } = world.copy.steps;
  const names = namer(world);
  const parts = form.slots.map((slot) => {
    const picked = names([...slot.categoryIds, ...slot.menuItemIds]);
    return fill(summary.part, { quantity: slot.quantity, names: picked.length > 0 ? picked.join(summary.or) : summary.nothing });
  });
  return parts.length > 0 ? parts.join(summary.plus) : summary.nothing;
}

function freeCounts(form: FormSnapshot): { units: number; paid: number } {
  const units = form.slots[0]?.quantity ?? 0;
  const free = Number(form.values.freeUnits ?? "");
  return { units, paid: Math.max(0, units - (Number.isFinite(free) ? free : 0)) };
}

function capText(form: FormSnapshot, world: SummaryWorld): string {
  const { summary } = world.copy.steps;
  const cap = (form.values.maxComboApplications ?? "").trim();
  return cap === "" ? summary.capAny : fill(summary.capCount, { count: cap });
}

/** "15%" or "R$ 20,00", for the value the kind (or the combo's reward) holds; "…" before one is typed. */
function valueText(form: FormSnapshot, world: SummaryWorld): string {
  const { values } = form;
  const { type } = typeAndScopeFor({ kind: values.kind ?? "", comboReward: values.comboReward ?? "", scope: values.scope ?? "" });
  const { formatters } = world;
  const typed = (key: string): string => values[key] ?? "";
  const money = (key: string): string => {
    const cents = toCents(typed(key), formatters);
    return cents === null ? world.copy.steps.summary.nothing : formatters.money(cents);
  };
  if (type === "FIXED_AMOUNT") return money("amountOff");
  if (type === "BUNDLE_PRICE") return money("bundlePrice");
  const basisPoints = toBasisPoints(typed("percentOff"), formatters);
  return basisPoints === null ? world.copy.steps.summary.nothing : formatters.percent(basisPoints);
}

function targetsLine(form: FormSnapshot, world: SummaryWorld): string {
  const { summary } = world.copy.steps;
  const names = namer(world);
  const scope = form.values.scope ?? "ORDER";
  if (scope === "CATEGORY") return fill(summary.categories, { names: names(form.categoryIds).join(summary.list) || summary.nothing });
  if (scope === "ITEM") return fill(summary.products, { names: names(form.menuItemIds).join(summary.list) || summary.nothing });
  return summary.wholeOrder;
}

/** "Cliente paga R$ 30,00 — economiza …", or null when there is nothing honest to sum. */
function paysLine(form: FormSnapshot, world: SummaryWorld): string | null {
  const { values } = form;
  const reward = {
    type: comboRewardOf({ type: values.comboReward ?? "" }),
    percentOffBp: toBasisPoints(values.percentOff ?? "", world.formatters),
    amountOffCents: toCents(values.amountOff ?? "", world.formatters),
    bundlePriceCents: toCents(values.bundlePrice ?? "", world.formatters),
  };
  const preview = comboPreviewOf(form.slots, world.groups, reward);
  if (preview === null) return null;
  return comboPreviewLines(preview, reward, "inline", world.copy, world.formatters).pays;
}

function joinDetail(parts: readonly (string | null)[], world: SummaryWorld): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(world.copy.steps.summary.detailSeparator);
}

/** Step 1: "{Tipo} · {Nome}". */
function stepOneLines(form: FormSnapshot, world: SummaryWorld): DoneLines {
  const kind = world.copy.labels.kind[kindOfSnapshot(form)];
  return { answer: fill(world.copy.steps.summary.kindAndName, { kind, name: (form.values.name ?? "").trim() }), detail: "" };
}

/** Step 2: the groups, the free line, or where the discount applies. */
function stepTwoLines(form: FormSnapshot, world: SummaryWorld): DoneLines {
  const { copy } = world;
  const kind = kindOfSnapshot(form);
  if (kind === "COMBO") {
    const units = comboUnits(form.slots);
    const detail = fill(copy.combo.summary, {
      units: fill(units === 1 ? copy.combo.unitsOne : copy.combo.unitsOther, { count: units }),
      groups: fill(form.slots.length === 1 ? copy.combo.groupsOne : copy.combo.groupsOther, { count: form.slots.length }),
    });
    return { answer: fill(copy.steps.summary.comboParts, { parts: comboParts(form, world) }), detail };
  }
  if (kind === "FREE_UNITS") {
    const products = namer(world)(form.slots.flatMap((slot) => slot.menuItemIds)).join(copy.steps.summary.list);
    return { answer: fill(copy.steps.summary.freeLine, freeCounts(form)), detail: products };
  }
  return { answer: targetsLine(form, world), detail: "" };
}

/** Step 3: the reward and its value, the cart preview's line, the cap. */
function stepThreeLines(form: FormSnapshot, world: SummaryWorld): DoneLines {
  const { copy } = world;
  const { summary } = copy.steps;
  const kind = kindOfSnapshot(form);
  if (kind === "FREE_UNITS") return { answer: fill(summary.freeCap, { cap: capText(form, world) }), detail: "" };
  if (kind === "COMBO") {
    const reward = copy.comboRewards.labels[comboRewardOf({ type: form.values.comboReward ?? "" })];
    return {
      answer: `${reward}${summary.detailSeparator}${valueText(form, world)}`,
      detail: joinDetail([paysLine(form, world), fill(summary.comboCap, { cap: capText(form, world) })], world),
    };
  }
  const label = kind === "FIXED_AMOUNT" ? copy.form.amountOff : copy.form.percentOff;
  return { answer: fill(summary.labelled, { label, value: valueText(form, world) }), detail: "" };
}

/** A day as the chips write it: the typed text until it is a whole day. */
function dayText(value: string, world: SummaryWorld): string {
  return isIsoDay(value) ? world.formatters.date(value) : value;
}

/** "Sem prazo", "A partir de …", "Até …" or "… a …". */
export function periodChip(form: FormSnapshot, world: SummaryWorld): string {
  const { window } = world.copy;
  const from = (form.values.startsAt ?? "").trim();
  const to = (form.values.endsAt ?? "").trim();
  if (from === "" && to === "") return window.always;
  if (from !== "" && to !== "") return fill(window.between, { from: dayText(from, world), to: dayText(to, world) });
  return from !== "" ? fill(window.from, { date: dayText(from, world) }) : fill(window.until, { date: dayText(to, world) });
}

function activationChip(form: FormSnapshot, world: SummaryWorld): string {
  const { chips } = world.copy.steps;
  if (form.values.trigger !== "CODE") return chips.automatic;
  const code = (form.values.code ?? "").trim();
  return code === "" ? chips.couponNoCode : fill(chips.coupon, { code });
}

function scheduleChip(form: FormSnapshot, world: SummaryWorld): string {
  const { chips } = world.copy.steps;
  if (!form.scheduleEnabled) return chips.everyDay;
  return form.schedule.windows
    .map((window) => fill(chips.window, { days: formatDays(window.days, world.copy) ?? "", from: window.from, to: window.to }))
    .join(world.copy.steps.summary.detailSeparator);
}

function limitsChip(form: FormSnapshot, world: SummaryWorld): string {
  const { chips } = world.copy.steps;
  const { values } = form;
  const parts: string[] = [];
  const min = (values.minSubtotal ?? "").trim();
  if (min !== "") parts.push(fill(chips.minSubtotal, { amount: world.formatters.money(toCents(min, world.formatters)) }));
  if ((values.usageLimit ?? "").trim() !== "") parts.push(fill(chips.usage, { count: values.usageLimit!.trim() }));
  if ((values.perBuyerLimit ?? "").trim() !== "") parts.push(fill(chips.perBuyer, { count: values.perBuyerLimit!.trim() }));
  return parts.length > 0 ? parts.join(world.copy.steps.summary.detailSeparator) : chips.noLimits;
}

function isPlain(form: FormSnapshot): boolean {
  const kind = kindOfSnapshot(form);
  return kind === "PERCENTAGE" || kind === "FIXED_AMOUNT";
}

/** The "Resumo" chips, in order; step 4's done line joins them. */
export function ruleChips(form: FormSnapshot, world: SummaryWorld): string[] {
  const { chips } = world.copy.steps;
  return [
    activationChip(form, world),
    periodChip(form, world),
    scheduleChip(form, world),
    limitsChip(form, world),
    ...(isPlain(form) && form.firstOrderOnly ? [chips.firstOrder] : []),
    form.stackable ? chips.stackable : chips.exclusive,
    form.active ? chips.active : chips.paused,
  ];
}

/** The done card of step n: its bold answer and its muted line. */
export function doneLines(step: 1 | 2 | 3 | 4, form: FormSnapshot, world: SummaryWorld): DoneLines {
  if (step === 1) return stepOneLines(form, world);
  if (step === 2) return stepTwoLines(form, world);
  if (step === 3) return stepThreeLines(form, world);
  return { answer: ruleChips(form, world).join(world.copy.steps.summary.detailSeparator), detail: world.copy.steps.rulesDone };
}

function comboSentence(form: FormSnapshot, world: SummaryWorld): string {
  const { summary } = world.copy.steps;
  const value = valueText(form, world);
  const type = comboRewardOf({ type: form.values.comboReward ?? "" });
  const reward =
    type === "BUNDLE_PRICE"
      ? fill(summary.sentencePrice, { price: value })
      : type === "PERCENTAGE"
        ? fill(summary.sentencePercent, { percent: value })
        : fill(summary.sentenceAmount, { amount: value });
  return fill(summary.sentenceCombo, { parts: comboParts(form, world), reward });
}

function freeSentence(form: FormSnapshot, world: SummaryWorld): string {
  const { summary } = world.copy.steps;
  const names = namer(world)(form.slots.flatMap((slot) => slot.menuItemIds));
  const products = names.length > 0 ? fill(summary.sentenceFreeProducts, { names: names.join(summary.or) }) : "";
  return fill(summary.sentenceFree, { ...freeCounts(form), products });
}

function plainSentence(form: FormSnapshot, world: SummaryWorld): string {
  const { summary } = world.copy.steps;
  const scope = form.values.scope ?? "ORDER";
  const ids = scope === "CATEGORY" ? form.categoryIds : form.menuItemIds;
  const where =
    scope === "ORDER"
      ? summary.sentenceWholeOrder
      : fill(summary.sentenceTargets, { names: namer(world)(ids).join(summary.list) || summary.nothing });
  return fill(summary.sentencePlain, { value: valueText(form, world), where });
}

/** The "Resumo" sentence. */
export function resumoSentence(form: FormSnapshot, world: SummaryWorld): string {
  const kind = kindOfSnapshot(form);
  if (kind === "COMBO") return comboSentence(form, world);
  if (kind === "FREE_UNITS") return freeSentence(form, world);
  return plainSentence(form, world);
}

export interface StripChip {
  id: "active" | "activation" | "period" | "stacking" | "limits" | "firstOrder";
  label: string;
  /** Amber: a paused promotion is the one chip that is a warning. */
  warn: boolean;
}

/** The status strip of an edited rule, in order (FUT-4478). */
export function stripChips(form: FormSnapshot, world: SummaryWorld): StripChip[] {
  const { chips } = world.copy.steps;
  const { values } = form;
  const limited = ["minSubtotal", "usageLimit", "perBuyerLimit"].some((key) => (values[key] ?? "").trim() !== "");
  const period = periodChip(form, world);
  return [
    { id: "active", label: form.active ? chips.active : chips.paused, warn: !form.active },
    { id: "activation", label: activationChip(form, world), warn: false },
    { id: "period", label: form.scheduleEnabled ? fill(chips.withSchedule, { period }) : period, warn: false },
    { id: "stacking", label: form.stackable ? chips.stackable : chips.exclusive, warn: false },
    { id: "limits", label: limited ? chips.withLimits : chips.noLimits, warn: false },
    ...(isPlain(form)
      ? [{ id: "firstOrder" as const, label: form.firstOrderOnly ? chips.firstOrder : chips.anyBuyer, warn: false }]
      : []),
  ];
}
