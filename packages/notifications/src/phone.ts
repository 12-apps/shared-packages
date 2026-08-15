/**
 * Shared phone-destination rules for the SMS + WhatsApp transports.
 *
 * Providers need E.164 (`+5531999998888`); a host stores the phone as the user
 * entered it. Best-effort normalization: an explicit `+` prefix is trusted; a
 * bare 10/11-digit number is assumed to belong to `defaultCountryCode` and
 * prefixed; anything else is unusable and makes the channel unavailable for
 * that recipient.
 *
 * `defaultCountryCode` is REQUIRED, and that is the whole point of it being a
 * parameter. It used to default to `55` (Brazil, the first host's market),
 * which a published package must not do: a US adopter that never set it turned
 * `4155552671` into `+554155552671` — a plausible Brazilian mobile — and sent a
 * stranger the customer's order details. There is no country this package could
 * assume that is not wrong for every other adopter, so it assumes none and the
 * omission is a compile error rather than a wrong number. the origin passes
 * `'55'` explicitly.
 *
 * NOTE: "verified phone" is approximated by "has a normalizable phone on
 * file" — a host with a real verification flow should tighten its contact
 * directory to only return verified numbers, which is the single seam both
 * transports funnel through.
 */

/** Options for {@link normalizePhoneE164}. */
export interface PhoneNormalizeOptions {
  /**
   * Country calling code for a bare local number, digits only (`'55'`, `'1'`).
   * Required: see the module docstring for why there is no default.
   */
  defaultCountryCode: string;
}

/** A local subscriber number: area code (2) + 8 or 9 digits. */
const isLocal = (digits: string): boolean => digits.length === 10 || digits.length === 11;

/** An already-international number. E.164 allows 8..15 digits. */
const international = (digits: string): string | null =>
  digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

/** Normalize a stored phone to E.164, or null when it can't be inferred. */
export function normalizePhoneE164(
  raw: string | null | undefined,
  options: PhoneNormalizeOptions,
): string | null {
  if (!raw) return null;
  const country = options.defaultCountryCode;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return international(digits);
  if (isLocal(digits)) return `+${country}${digits}`;
  // A bare number that already carries the country code.
  if (digits.startsWith(country) && isLocal(digits.slice(country.length))) {
    return `+${digits}`;
  }
  return null;
}
