/**
 * Shared phone-destination rules for the SMS + WhatsApp transports.
 *
 * Providers need E.164 (`+5531999998888`); a host stores the phone as the user
 * entered it. Best-effort normalization: an explicit `+` prefix is trusted; a
 * bare 10/11-digit number is assumed to belong to `defaultCountryCode` (`55`,
 * Brazil, unless the host says otherwise) and prefixed; anything else is
 * unusable and makes the channel unavailable for that recipient.
 *
 * NOTE: "verified phone" is approximated by "has a normalizable phone on
 * file" — a host with a real verification flow should tighten its contact
 * directory to only return verified numbers, which is the single seam both
 * transports funnel through.
 */

/** Options for {@link normalizePhoneE164}. */
export interface PhoneNormalizeOptions {
  /** Country calling code for a bare local number. Default `55` (Brazil). */
  defaultCountryCode?: string;
}

/** A local subscriber number: area code (2) + 8 or 9 digits. */
const isLocal = (digits: string): boolean => digits.length === 10 || digits.length === 11;

/** An already-international number. E.164 allows 8..15 digits. */
const international = (digits: string): string | null =>
  digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

/** Normalize a stored phone to E.164, or null when it can't be inferred. */
export function normalizePhoneE164(
  raw: string | null | undefined,
  options: PhoneNormalizeOptions = {},
): string | null {
  if (!raw) return null;
  const country = options.defaultCountryCode ?? '55';
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
