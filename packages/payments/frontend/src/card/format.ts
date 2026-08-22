import type { CardBrand, CardFieldCopy } from "./copy";

/**
 * Client-side card formatting + validation (FUT-58).
 *
 * Pure helpers — the card form uses them to format input live and to validate
 * before tokenizing. They never transmit anything; the PAN is only checked
 * locally (Luhn + brand + length) then handed to the tokenizer.
 *
 * The validators take the host's words (FUT-760). WHICH refusal a value earns
 * is the rule, and it stays here; the sentence is not ours.
 */

export type { CardBrand } from "./copy";

/** Strip everything but digits. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Best-effort brand detection from the leading digits. */
export function detectBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^6/.test(digits)) return "Elo";
  return "Unknown";
}

/** Expected CVV length for a brand (Amex uses 4, everyone else 3). */
export function cvvLength(brand: CardBrand): number {
  return brand === "Amex" ? 4 : 3;
}

/** Format a PAN into brand-appropriate groups, e.g. `4242 4242 4242 4242`. */
export function formatCardNumber(value: string): string {
  const digits = onlyDigits(value).slice(0, 19);
  const groups = detectBrand(digits) === "Amex" ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let cursor = 0;
  for (const size of groups) {
    if (cursor >= digits.length) break;
    parts.push(digits.slice(cursor, cursor + size));
    cursor += size;
  }
  return parts.join(" ");
}

/** Format an expiry as `MM/YY`, inserting the slash after the month. */
export function formatExpiry(value: string): string {
  const digits = onlyDigits(value).slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Keep CVV digits only (max 4). */
export function formatCvv(value: string): string {
  return onlyDigits(value).slice(0, 4);
}

/** Luhn checksum — rejects mistyped/invalid card numbers. */
function luhnValid(digits: string): boolean {
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48; // '0' → 0
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** @returns an error message, or `undefined` when valid. */
export function validateCardNumber(
  value: string,
  copy: CardFieldCopy,
): string | undefined {
  const digits = onlyDigits(value);
  if (!digits) return copy.numberRequired;
  if (digits.length < 13) return copy.numberIncomplete;
  if (!luhnValid(digits)) return copy.numberInvalid;
  return undefined;
}

export function validateHolder(value: string, copy: CardFieldCopy): string | undefined {
  return value.trim().length < 2 ? copy.holderRequired : undefined;
}

export function validateExpiry(
  value: string,
  copy: CardFieldCopy,
  now: Date = new Date(),
): string | undefined {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return "Validade incompleta (MM/AA).";
  const mm = match[1];
  const yy = match[2];
  if (mm === undefined || yy === undefined) return "Validade incompleta (MM/AA).";
  const month = Number(mm);
  if (month < 1 || month > 12) return copy.monthInvalid;
  const endOfMonth = new Date(2000 + Number(yy), month, 0, 23, 59, 59, 999);
  return endOfMonth.getTime() < now.getTime() ? copy.expired : undefined;
}

export function validateCvv(
  value: string,
  copy: CardFieldCopy,
  brand: CardBrand = "Unknown",
): string | undefined {
  const digits = onlyDigits(value);
  if (!digits) return "Informe o CVV.";
  const len = cvvLength(brand);
  return digits.length === len ? undefined : copy.cvvDigits(len);
}
