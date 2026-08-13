/**
 * The formatters a SPA needs in the browser, where the server-only ones cannot go.
 *
 * `@12-apps/shared-helpers`' money formatter is effectively server-side (CJS
 * dist), so a browser bundle either grows its own copy per app or shares this
 * one. The non-breaking space `Intl` emits is normalized to a regular space,
 * matching a backend's pre-formatted labels so a screen mixing both never
 * differs by an invisible character — which is the kind of difference that
 * reaches a screenshot diff and nothing else.
 */

/** Locale + currency for {@link formatMoney}. Defaults are pt-BR / BRL. */
export interface MoneyFormat {
  locale?: string;
  currency?: string;
}

/**
 * Minor units (cents) → a currency label.
 *
 * Takes the locale and currency rather than assuming them: the default is the
 * pt-BR product this was extracted from, and a second host with a second
 * currency is a config entry rather than a second function.
 */
export function formatMoney(minorUnits: number, format: MoneyFormat = {}): string {
  const { locale = 'pt-BR', currency = 'BRL' } = format;
  return new Intl.NumberFormat(locale, { style: 'currency', currency })
    .format(minorUnits / 100)
    .replaceAll(' ', ' ');
}

/** {@link formatMoney} at its pt-BR / BRL default — the preset the SPAs use. */
export function formatBRL(cents: number): string {
  return formatMoney(cents);
}

/**
 * `"45 min"`-style label for a duration held in seconds.
 *
 * `null`/`0` (unset, or instant) render as `null` so the caller omits the row
 * instead of showing a meaningless "0 min". Rounds to the nearest minute but
 * never below 1 — a 15-second duration is real and must not read as "0 min",
 * which a reader would take for "no delay".
 */
export function formatMinutesLabel(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}
