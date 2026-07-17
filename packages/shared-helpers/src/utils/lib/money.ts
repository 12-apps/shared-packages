const NON_BREAKING_SPACE = ' ';
const ASCII_SPACE = ' ';
// (module-level BRL helpers below — all amounts are integer cents to avoid float drift)

/**
 * Shared, module-scope formatter. `Intl.NumberFormat('pt-BR', BRL)` emits a
 * non-breaking space (U+00A0) between `R$` and the number, which {@link formatBRL}
 * normalizes to an ASCII space. Hoisted to module scope so the formatter is
 * constructed once instead of on every call.
 */
const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Format an integer cents amount as a pt-BR BRL currency string.
 *
 * The raw `Intl` output contains a non-breaking space (U+00A0); it is replaced
 * with an ASCII space so the result is deterministic across Node ICU versions
 * (e.g. `formatBRL(1990) === 'R$ 19,90'`).
 *
 * @param cents - The amount in integer cents.
 * @returns The formatted BRL string with an ASCII space (e.g. `'R$ 19,90'`).
 */
function formatBRL(cents: number): string {
  return BRL_FORMATTER.format(cents / 100).replaceAll(
    NON_BREAKING_SPACE,
    ASCII_SPACE,
  );
}

/**
 * Convert a decimal currency value to integer cents, rounding to the nearest cent.
 *
 * @param value - The amount as a decimal number (e.g. `19.9`).
 * @returns The amount in integer cents (e.g. `1990`).
 */
function toCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Convert integer cents to a decimal currency value.
 *
 * @param cents - The amount in integer cents (e.g. `1990`).
 * @returns The amount as a decimal number (e.g. `19.9`).
 */
function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Parse a BRL currency string back into integer cents.
 *
 * Strips currency symbols and grouping characters, treats `,` as the decimal
 * separator, then rounds to the nearest cent via {@link toCents}.
 *
 * @param input - A BRL string (e.g. `'R$ 19,90'`).
 * @returns The amount in integer cents (e.g. `1990`).
 */
function parseBRL(input: string): number {
  const digits = input.replace(/[^0-9,-]/g, '').replace(',', '.');
  return toCents(Number(digits));
}

export { formatBRL, fromCents, parseBRL, toCents };
