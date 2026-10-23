/**
 * The DDD + local digits of a Brazilian number, in whatever shape the buyer
 * typed it or their phone autofilled it (FUT-3955): `+55 31 99449-4408`,
 * `5531994494408`, `0055…`, `(31) 99449-4408`, a trunk `0`. `null` when it
 * cannot be one: a `+`/`00` number from another country, or 12–13 digits
 * without the 55 (which keeps DDD 55, Santa Maria, from reading as a DDI). The
 * server's gate reads it the same way (payments-backend `brLocalNumber`).
 */
export function brLocalNumber(value: string): string | null {
  const { digits, international } = withoutPrefixes(value);
  const prefixed = international || digits.length === 12 || digits.length === 13;
  if (!prefixed) return digits;
  return digits.startsWith("55") ? digits.slice(2) : null;
}

/**
 * The digits after an international `00` or `+` (flagged, so the country code
 * is then required), or the national digits once a single trunk `0` before a
 * 10- or 11-digit number is dropped.
 */
function withoutPrefixes(value: string): { digits: string; international: boolean } {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) return { digits: digits.slice(2), international: true };
  if (trimmed.startsWith("+")) return { digits, international: true };
  const trunk = digits.startsWith("0") && (digits.length === 11 || digits.length === 12);
  return { digits: trunk ? digits.slice(1) : digits, international: false };
}
