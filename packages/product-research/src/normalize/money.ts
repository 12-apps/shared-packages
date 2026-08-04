/**
 * Parse a human money string into integer cents. Accepts the shapes connectors
 * and imported price lists actually contain: "R$ 1.234,56", "1234,56",
 * "1234.56", "R$4,29", plain numbers. Returns null rather than guessing when
 * the string is not a price.
 */
export const parseMoneyToCents = (value: string | number): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  const cleaned = value.replace(/[^\d.,-]/g, '');
  if (!cleaned || cleaned === '-') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) {
    // pt-BR: "." groups thousands, "," is the decimal separator.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned;
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};
