import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { normalizePhoneE164 } from '../phone';

/**
 * The small, pure rules of the consent engine: what a reply MEANS,
 * which number it came from, and the one-time code — kept apart from the
 * engine so each reads as one rule.
 */

/** The two billed channels, the only ones consent and caps speak about. */
export const PAID_CHANNELS = ['SMS', 'WHATSAPP'] as const;
export type PaidChannel = (typeof PAID_CHANNELS)[number];

export const isPaidChannel = (value: unknown): value is PaidChannel =>
  value === 'SMS' || value === 'WHATSAPP';

/**
 * A reply folded to what a keyword is compared with: no case, no accents, and
 * nothing but letters or digits at either end. `"  Sím. "`, `"SIM 👍"` and
 * `"sim"` are one word; `"sim, quero"` and `"sair do grupo"` stay sentences,
 * because only the ENDS are trimmed — the whole text must be the keyword
 * (the rule `@12-apps/messaging` applies to its own opt-out words).
 */
export function foldReply(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** The host's keywords, folded once at mount. */
export function keywordSet(keywords: readonly string[]): ReadonlySet<string> {
  return new Set(keywords.map(foldReply).filter((word) => word.length > 0));
}

/** What one inbound message asks for, or `null` when it is not a keyword. */
export function replyIntent(
  input: { text?: string; optOut?: boolean },
  words: { confirm: ReadonlySet<string>; optOut: ReadonlySet<string> },
): 'CONFIRM' | 'OPT_OUT' | null {
  if (input.optOut === true) return 'OPT_OUT';
  if (input.text === undefined) return null;
  const folded = foldReply(input.text);
  if (words.optOut.has(folded)) return 'OPT_OUT';
  if (words.confirm.has(folded)) return 'CONFIRM';
  return null;
}

/**
 * The sender of an inbound message, as E.164.
 *
 * A provider reports the sender INTERNATIONALLY — Meta as bare digits
 * (`5511987654321`), Twilio with a `+` — so the digits are taken as they are.
 * The host's default country is deliberately NOT applied: an 11-digit
 * international number would read as a local one and be re-prefixed.
 */
export function inboundDestination(from: string): string | null {
  const digits = from.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** The phone a person has on file, as the E.164 consent is keyed by. */
export function storedDestination(
  phone: string | null | undefined,
  defaultCountryCode: string,
): string | null {
  return normalizePhoneE164(phone, { defaultCountryCode });
}

/** A fresh 6-digit code, uniformly drawn (leading zeros kept). */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * What is stored IN PLACE of the code. Salted with the row's id, so one hash
 * says nothing about any other row's code. A 6-digit space is small, which is
 * why the tries are counted in the database and the code dies in minutes: the
 * hash only keeps the code out of a dump, a log and a backup.
 */
export function hashCode(rowId: string, code: string): string {
  return createHash('sha256').update(`${rowId}:${code}`).digest('base64url');
}

/** Constant-time comparison of a typed code against the stored hash. */
export function codeMatches(rowId: string, code: string, stored: string): boolean {
  const typed = Buffer.from(hashCode(rowId, code));
  const expected = Buffer.from(stored);
  return typed.length === expected.length && timingSafeEqual(typed, expected);
}
