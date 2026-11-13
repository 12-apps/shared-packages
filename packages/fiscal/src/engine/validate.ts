/**
 * Input and table validation. Every check names the field it refused, so a
 * host sees which of its own values was wrong, never a NaN on a document.
 */

import { FiscalEngineError } from "./errors";
import type { FiscalEngineErrorCode } from "./errors";
import type { IsoDate, RatePeriod, RateTables, TaxClass, TaxInput, TaxLineInput, TaxRegime } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const IBGE_MUNICIPALITY = /^\d{7}$/;
const IBGE_UF = /^\d{2}$/;
const REGIMES: readonly TaxRegime[] = ["REGIME_REGULAR", "SIMPLES_IBS_CBS_REGULAR", "SIMPLES", "MEI", "NAO_CONTRIBUINTE"];

function refuse(code: FiscalEngineErrorCode, message: string): never {
  throw new FiscalEngineError(code, message);
}

/** A real calendar day in `YYYY-MM-DD` — `2026-02-30` is not one. */
function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBp(value: unknown): value is number {
  return isCents(value) && value <= 10_000;
}

function assertInput(ok: boolean, what: string): void {
  if (!ok) refuse("INVALID_INPUT", what);
}

function assertTable(ok: boolean, what: string): void {
  if (!ok) refuse("INVALID_TABLES", what);
}

function assertTaxClass(taxClass: TaxClass, where: string): void {
  assertInput(typeof taxClass?.cClassTrib === "string" && taxClass.cClassTrib !== "", `${where}.cClassTrib must be a code`);
  assertInput(typeof taxClass.cstIbsCbs === "string" && taxClass.cstIbsCbs !== "", `${where}.cstIbsCbs must be a code`);
  assertInput(
    taxClass.regimeEspecifico === null || taxClass.regimeEspecifico === "BARES_RESTAURANTES",
    `${where}.regimeEspecifico must be "BARES_RESTAURANTES" or null`,
  );
  assertInput(isBp(taxClass.reductionBp), `${where}.reductionBp must be integer basis points in 0..10000`);
}

function assertLine(line: TaxLineInput, index: number): void {
  const where = `lines[${index}]`;
  assertInput(typeof line.id === "string" && line.id !== "", `${where}.id must be a non-empty string`);
  assertInput(isCents(line.baseCents), `${where}.baseCents must be non-negative integer cents`);
  assertInput(
    typeof line.quantity === "number" && Number.isFinite(line.quantity) && line.quantity > 0,
    `${where}.quantity must be a positive number`,
  );
  assertInput(typeof line.foodAndDrink === "boolean", `${where}.foodAndDrink must be a boolean`);
  assertTaxClass(line.taxClass, `${where}.taxClass`);
}

function assertUniqueIds(input: TaxInput): void {
  const ids = input.lines.map((line) => line.id);
  if (input.exclusions.serviceCharge) ids.push(input.exclusions.serviceCharge.id);
  const seen = new Set<string>();
  for (const id of ids) {
    assertInput(!seen.has(id), `line id "${id}" is used twice`);
    seen.add(id);
  }
}

function assertExclusions(input: TaxInput): void {
  const { serviceCharge, retainedIntermediationCents } = input.exclusions;
  assertInput(isCents(retainedIntermediationCents), "exclusions.retainedIntermediationCents must be non-negative integer cents");
  if (serviceCharge === null) return;
  assertInput(typeof serviceCharge.id === "string" && serviceCharge.id !== "", "exclusions.serviceCharge.id must be a non-empty string");
  assertInput(isCents(serviceCharge.amountCents), "exclusions.serviceCharge.amountCents must be non-negative integer cents");
  assertInput(typeof serviceCharge.passedToStaff === "boolean", "exclusions.serviceCharge.passedToStaff must be a boolean");
  assertTaxClass(serviceCharge.taxClass, "exclusions.serviceCharge.taxClass");
}

function assertSeller(input: TaxInput): void {
  assertInput(REGIMES.includes(input.seller?.regime), `seller.regime must be one of ${REGIMES.join(", ")}`);
  assertInput(isIsoDate(input.seller.regimeEffectiveFrom), "seller.regimeEffectiveFrom must be a YYYY-MM-DD day");
  assertInput(typeof input.seller.restaurantRegime === "boolean", "seller.restaurantRegime must be a boolean");
}

/** Refuse anything the engine cannot compute from. */
export function assertTaxInput(input: TaxInput): void {
  assertInput(Array.isArray(input.lines) && input.lines.length > 0, "lines must hold at least one line");
  input.lines.forEach(assertLine);
  assertSeller(input);
  assertInput(
    typeof input.destinationIbge === "string" && IBGE_MUNICIPALITY.test(input.destinationIbge),
    "destinationIbge must be a 7-digit IBGE municipality code",
  );
  assertExclusions(input);
  assertUniqueIds(input);
  assertInput(isIsoDate(input.supplyDate), "supplyDate must be a YYYY-MM-DD day");
  assertRateTables(input.tables);
}

function assertRateMap(map: Readonly<Record<string, number>>, keyShape: RegExp, where: string): void {
  assertTable(typeof map === "object" && map !== null, `${where} must be an object`);
  for (const [key, bp] of Object.entries(map)) {
    assertTable(keyShape.test(key), `${where} key "${key}" is not an IBGE code of the right length`);
    assertTable(isBp(bp), `${where}["${key}"] must be integer basis points in 0..10000`);
  }
}

function assertPeriod(period: RatePeriod, index: number): void {
  const where = `periods[${index}]`;
  assertTable(isIsoDate(period.from), `${where}.from must be a YYYY-MM-DD day`);
  assertTable(period.to === null || (isIsoDate(period.to) && period.to >= period.from), `${where}.to must be null or a day on or after from`);
  assertTable(period.status === "LAW" || period.status === "ESTIMATE", `${where}.status must be LAW or ESTIMATE`);
  assertTable(typeof period.informative === "boolean", `${where}.informative must be a boolean`);
  assertTable(typeof period.appliesToSimplesNacional === "boolean", `${where}.appliesToSimplesNacional must be a boolean`);
  assertTable(isBp(period.cbsBp), `${where}.cbsBp must be integer basis points in 0..10000`);
  assertTable(isBp(period.ibsUf?.referenceBp), `${where}.ibsUf.referenceBp must be integer basis points`);
  assertTable(isBp(period.ibsMun?.referenceBp), `${where}.ibsMun.referenceBp must be integer basis points`);
  assertRateMap(period.ibsUf.byUf, IBGE_UF, `${where}.ibsUf.byUf`);
  assertRateMap(period.ibsMun.byMunicipality, IBGE_MUNICIPALITY, `${where}.ibsMun.byMunicipality`);
}

/** Refuse a table the engine cannot trust: bad rates, bad dates, overlapping periods. */
export function assertRateTables(tables: RateTables): void {
  assertTable(typeof tables?.version === "string" && tables.version !== "", "version must be a non-empty string");
  assertTable(isBp(tables.gorjetaCapBp), "gorjetaCapBp must be integer basis points in 0..10000");
  assertTable(isBp(tables.specialRegimes?.BARES_RESTAURANTES?.reductionBp), "specialRegimes.BARES_RESTAURANTES.reductionBp must be basis points");
  assertTable(Array.isArray(tables.periods) && tables.periods.length > 0, "periods must hold at least one period");
  tables.periods.forEach(assertPeriod);
  const sorted = [...tables.periods].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    assertTable(previous.to !== null && previous.to < sorted[i]!.from, `periods starting ${previous.from} and ${sorted[i]!.from} overlap`);
  }
}

/** The period covering `date`, or a refusal. */
export function periodAt(tables: RateTables, date: IsoDate): RatePeriod {
  const period = tables.periods.find((p) => p.from <= date && (p.to === null || date <= p.to));
  return period ?? refuse("NO_RATE_PERIOD", `table ${tables.version} has no period covering ${date}`);
}
