/**
 * Input and table validation. Every check names the field it refused, and
 * every shape is checked before it is read, so a malformed input — a missing
 * object, an `undefined` where `null` is required, a `null` line — is a
 * `FiscalEngineError`, never a TypeError and never a NaN on a document.
 */

import { FiscalEngineError } from "./errors";
import type { FiscalEngineErrorCode } from "./errors";
import type { IsoDate, RatePeriod, RateTables, TaxClass, TaxClassCode, TaxInput, TaxLineInput, TaxRegime } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const IBGE_MUNICIPALITY = /^\d{7}$/;
const IBGE_UF = /^\d{2}$/;
const REGIMES: readonly TaxRegime[] = ["REGIME_REGULAR", "SIMPLES_IBS_CBS_REGULAR", "SIMPLES", "MEI", "NAO_CONTRIBUINTE"];

function refuse(code: FiscalEngineErrorCode, message: string): never {
  throw new FiscalEngineError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isCode(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Positive, finite, and at most four decimals — what `qCom` can carry. */
function isQuantity(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
  const tenThousandths = Math.round(value * 10_000);
  return tenThousandths > 0 && Number.isSafeInteger(tenThousandths) && Math.abs(tenThousandths / 10_000 - value) < 1e-9;
}

function assertInput(ok: boolean, what: string): void {
  if (!ok) refuse("INVALID_INPUT", what);
}

function assertTable(ok: boolean, what: string): void {
  if (!ok) refuse("INVALID_TABLES", what);
}

function assertTaxClass(taxClass: unknown, where: string): asserts taxClass is TaxClass {
  assertInput(isRecord(taxClass), `${where} must be an object`);
  const value = taxClass as Record<string, unknown>;
  assertInput(isCode(value.cClassTrib), `${where}.cClassTrib must be a code`);
  assertInput(isCode(value.cstIbsCbs), `${where}.cstIbsCbs must be a code`);
  assertInput(
    value.regimeEspecifico === null || value.regimeEspecifico === "BARES_RESTAURANTES",
    `${where}.regimeEspecifico must be "BARES_RESTAURANTES" or null`,
  );
  assertInput(isBp(value.reductionBp), `${where}.reductionBp must be integer basis points in 0..10000`);
}

function assertLine(line: unknown, index: number): asserts line is TaxLineInput {
  const where = `lines[${index}]`;
  assertInput(isRecord(line), `${where} must be an object`);
  const value = line as Record<string, unknown>;
  assertInput(isCode(value.id), `${where}.id must be a non-empty string`);
  assertInput(isCents(value.valueCents), `${where}.valueCents must be non-negative integer cents`);
  assertInput(isQuantity(value.quantity), `${where}.quantity must be positive, with at most four decimals`);
  assertInput(typeof value.foodAndDrink === "boolean", `${where}.foodAndDrink must be a boolean`);
  assertTaxClass(value.taxClass, `${where}.taxClass`);
}

function assertServiceCharge(charge: unknown): void {
  if (charge === null) return;
  assertInput(isRecord(charge), "exclusions.serviceCharge must be an object or null");
  const value = charge as Record<string, unknown>;
  assertInput(isCode(value.id), "exclusions.serviceCharge.id must be a non-empty string");
  assertInput(isCents(value.amountCents), "exclusions.serviceCharge.amountCents must be non-negative integer cents");
  assertInput(typeof value.passedToStaff === "boolean", "exclusions.serviceCharge.passedToStaff must be a boolean");
  assertTaxClass(value.taxClass, "exclusions.serviceCharge.taxClass");
}

function assertIntermediation(retained: unknown): void {
  if (retained === null) return;
  assertInput(isRecord(retained), "exclusions.retainedIntermediation must be an object or null");
  const value = retained as Record<string, unknown>;
  assertInput(isCode(value.id), "exclusions.retainedIntermediation.id must be a non-empty string");
  assertInput(isCents(value.amountCents), "exclusions.retainedIntermediation.amountCents must be non-negative integer cents");
}

function assertExclusions(exclusions: unknown): void {
  assertInput(isRecord(exclusions), "exclusions must be an object");
  const value = exclusions as Record<string, unknown>;
  assertInput("serviceCharge" in value, "exclusions.serviceCharge must be given (null when there is none)");
  assertInput("retainedIntermediation" in value, "exclusions.retainedIntermediation must be given (null when there is none)");
  assertServiceCharge(value.serviceCharge);
  assertIntermediation(value.retainedIntermediation);
}

function assertUniqueIds(input: TaxInput): void {
  const ids = input.lines.map((line) => line.id);
  if (input.exclusions.serviceCharge) ids.push(input.exclusions.serviceCharge.id);
  if (input.exclusions.retainedIntermediation) ids.push(input.exclusions.retainedIntermediation.id);
  const seen = new Set<string>();
  for (const id of ids) {
    assertInput(!seen.has(id), `line id "${id}" is used twice`);
    seen.add(id);
  }
}

function assertSeller(seller: unknown): void {
  assertInput(isRecord(seller), "seller must be an object");
  const value = seller as Record<string, unknown>;
  assertInput(REGIMES.includes(value.regime as TaxRegime), `seller.regime must be one of ${REGIMES.join(", ")}`);
  assertInput(isIsoDate(value.regimeEffectiveFrom), "seller.regimeEffectiveFrom must be a YYYY-MM-DD day");
  assertInput(typeof value.restaurantRegime === "boolean", "seller.restaurantRegime must be a boolean");
}

/** Refuse anything the engine cannot compute from. */
export function assertTaxInput(input: unknown): asserts input is TaxInput {
  assertInput(isRecord(input), "the input must be an object");
  const value = input as Record<string, unknown>;
  assertInput(Array.isArray(value.lines) && value.lines.length > 0, "lines must hold at least one line");
  (value.lines as unknown[]).forEach(assertLine);
  assertSeller(value.seller);
  assertInput(
    typeof value.destinationIbge === "string" && IBGE_MUNICIPALITY.test(value.destinationIbge),
    "destinationIbge must be a 7-digit IBGE municipality code",
  );
  assertExclusions(value.exclusions);
  assertUniqueIds(input as TaxInput);
  assertInput(isIsoDate(value.supplyDate), "supplyDate must be a YYYY-MM-DD day");
  assertRateTables(value.tables);
}

function assertRateMap(map: unknown, keyShape: RegExp, where: string): void {
  assertTable(isRecord(map), `${where} must be an object`);
  for (const [key, bp] of Object.entries(map as Record<string, unknown>)) {
    assertTable(keyShape.test(key), `${where} key "${key}" is not an IBGE code of the right length`);
    assertTable(isBp(bp), `${where}["${key}"] must be integer basis points in 0..10000`);
  }
}

function assertSphere(sphere: unknown, mapKey: "byUf" | "byMunicipality", keyShape: RegExp, where: string): void {
  assertTable(isRecord(sphere), `${where} must be an object`);
  const value = sphere as Record<string, unknown>;
  assertTable(isBp(value.referenceBp), `${where}.referenceBp must be integer basis points in 0..10000`);
  assertRateMap(value[mapKey], keyShape, `${where}.${mapKey}`);
}

function assertPeriodFlags(value: Record<string, unknown>, where: string): void {
  assertTable(value.status === "LAW" || value.status === "ESTIMATE", `${where}.status must be LAW or ESTIMATE`);
  for (const flag of ["informative", "appliesToSimplesNacional", "taxInsidePrice"] as const) {
    assertTable(typeof value[flag] === "boolean", `${where}.${flag} must be a boolean`);
  }
}

function assertPeriod(period: unknown, index: number): asserts period is RatePeriod {
  const where = `periods[${index}]`;
  assertTable(isRecord(period), `${where} must be an object`);
  const value = period as Record<string, unknown>;
  assertTable(isIsoDate(value.from), `${where}.from must be a YYYY-MM-DD day`);
  assertTable(
    value.to === null || (isIsoDate(value.to) && value.to >= (value.from as string)),
    `${where}.to must be null or a day on or after from`,
  );
  assertPeriodFlags(value, where);
  assertTable(isBp(value.cbsBp), `${where}.cbsBp must be integer basis points in 0..10000`);
  assertSphere(value.ibsUf, "byUf", IBGE_UF, `${where}.ibsUf`);
  assertSphere(value.ibsMun, "byMunicipality", IBGE_MUNICIPALITY, `${where}.ibsMun`);
}

function assertClassCode(code: unknown, where: string): asserts code is TaxClassCode {
  assertTable(isRecord(code), `${where} must be an object`);
  const value = code as Record<string, unknown>;
  assertTable(isCode(value.cClassTrib) && isCode(value.cstIbsCbs), `${where} must carry cClassTrib and cstIbsCbs`);
}

function assertTableHeader(value: Record<string, unknown>): void {
  assertTable(isCode(value.version), "version must be a non-empty string");
  assertTable(isBp(value.gorjetaCapBp), "gorjetaCapBp must be integer basis points in 0..10000");
  const special = value.specialRegimes as Record<string, Record<string, unknown> | undefined> | undefined;
  assertTable(isRecord(special) && isRecord(special.BARES_RESTAURANTES), "specialRegimes.BARES_RESTAURANTES must be an object");
  assertTable(isBp(special!.BARES_RESTAURANTES!.reductionBp), "specialRegimes.BARES_RESTAURANTES.reductionBp must be basis points");
  assertTable(isRecord(value.exclusionClasses), "exclusionClasses must be an object");
  const classes = value.exclusionClasses as Record<string, unknown>;
  assertClassCode(classes.GORJETA, "exclusionClasses.GORJETA");
  assertClassCode(classes.INTERMEDIATION, "exclusionClasses.INTERMEDIATION");
}

/** Refuse a table the engine cannot trust: bad rates, bad dates, overlapping periods. */
export function assertRateTables(tables: unknown): asserts tables is RateTables {
  assertTable(isRecord(tables), "the rate table must be an object");
  const value = tables as Record<string, unknown>;
  assertTableHeader(value);
  assertTable(Array.isArray(value.periods) && value.periods.length > 0, "periods must hold at least one period");
  const periods = value.periods as unknown[];
  periods.forEach(assertPeriod);
  const sorted = [...(periods as RatePeriod[])].sort((a, b) => a.from.localeCompare(b.from));
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
