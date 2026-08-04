/**
 * Merchant-local (America/Sao_Paulo) time derivations for the reporting
 * catalog's `hourOfDay` / `dayOfWeek` dimensions. Date-range WINDOWS stay UTC
 * (repo-wide convention, half-open [from, toExclusive)); these derived
 * dimensions exist because "horário de pico" is only meaningful on the
 * merchant's clock, not UTC's.
 *
 * Prisma-free so the formulas are pure and unit-testable.
 */

const SP_TIME_ZONE = "America/Sao_Paulo";

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SP_TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
});

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SP_TIME_ZONE,
  weekday: "short",
});

/** ISO weekday order with pt-BR abbreviations; prefixed so sorts read Mon→Sun. */
const WEEKDAY_LABELS: Record<string, string> = {
  Mon: "1-seg",
  Tue: "2-ter",
  Wed: "3-qua",
  Thu: "4-qui",
  Fri: "5-sex",
  Sat: "6-sáb",
  Sun: "7-dom",
};

/** Local hour of day, zero-padded "00"–"23". */
export function hourOfDaySaoPaulo(instant: Date): string {
  return hourFormatter.format(instant);
}

/** Local day of week, "1-seg" (segunda) through "7-dom" (domingo). */
export function dayOfWeekSaoPaulo(instant: Date): string {
  return WEEKDAY_LABELS[weekdayFormatter.format(instant)] ?? "?";
}
