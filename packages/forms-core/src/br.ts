/**
 * Brazilian document + address primitives (FUT-306).
 *
 * Masks, shape checks and check-digit validation for the two fields every
 * pt-BR form asks for — CEP and CNPJ — plus the UF list. Pure and dependency
 * free like the rest of `forms-core`, so the SAME rules run in the browser
 * (input mask + inline validation), in a route handler (before hitting a
 * lookup provider) and in a test.
 *
 * @module forms-core/br
 */

import type { Validator } from './validators';

/** Brazilian federative units, for UF selects and client-side validation. */
export const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

/** A Brazilian federative unit. */
export type Uf = (typeof UF_LIST)[number];

/** True when `value` is one of the 27 {@link UF_LIST} entries (case-sensitive). */
export function isUf(value: string): value is Uf {
  return (UF_LIST as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// CEP
// ---------------------------------------------------------------------------

/** Canonical CEP shape after masking/normalization: `01310-100`. */
export const CEP_PATTERN = /^\d{5}-\d{3}$/;

/** The bare digits of a CEP, capped at the 8 a CEP has. */
export function cepDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8);
}

/**
 * Mask raw CEP input to `#####-###`: strips non-digits, caps at 8 digits and
 * inserts the hyphen once the sixth digit arrives. Pure — safe to run on every
 * keystroke and to normalize before matching {@link CEP_PATTERN}.
 */
export function formatCep(raw: string): string {
  const digits = cepDigits(raw);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/**
 * True when `raw` holds a complete, well-formed CEP.
 *
 * Shape only: a CEP is a postal RANGE allocated by the Correios, so there is no
 * check digit to verify. Whether it actually EXISTS is answered by a lookup,
 * not by this function.
 */
export function isValidCep(raw: string): boolean {
  return CEP_PATTERN.test(formatCep(raw));
}

/** Empty ⇒ valid (optional field); otherwise the value must be a full CEP. */
export const cep =
  (message = 'CEP inválido — use o formato 00000-000.'): Validator =>
  (value) =>
    value.trim() === '' || isValidCep(value) ? undefined : message;

// ---------------------------------------------------------------------------
// CNPJ
// ---------------------------------------------------------------------------

/** Canonical CNPJ shape after masking: `12.ABC.345/01DE-35`. */
export const CNPJ_PATTERN = /^[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}$/;

/** How many characters a CNPJ has, check digits included. */
const CNPJ_LENGTH = 14;

/**
 * Strip a CNPJ to its 14 significant characters, uppercased.
 *
 * Alphanumeric-aware (Receita Federal IN 2.229/2024, live in production since
 * 2026-07-06): the first 12 positions may be letters OR digits, so only
 * punctuation is removed — never letters.
 */
export function cnpjChars(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CNPJ_LENGTH);
}

/**
 * Mask raw CNPJ input to `##.###.###/####-##`, accepting letters in the first
 * twelve positions and digits in the two check positions.
 */
export function formatCnpj(raw: string): string {
  const chars = cnpjChars(raw);
  const parts = [
    chars.slice(0, 2),
    chars.slice(2, 5),
    chars.slice(5, 8),
    chars.slice(8, 12),
    // The check digits are always numeric, even on an alphanumeric CNPJ.
    chars.slice(12, 14).replace(/\D/g, ''),
  ];
  let masked = parts[0] as string;
  if (chars.length > 2) masked += `.${parts[1]}`;
  if (chars.length > 5) masked += `.${parts[2]}`;
  if (chars.length > 8) masked += `/${parts[3]}`;
  if (chars.length > 12) masked += `-${parts[4]}`;
  return masked;
}

/**
 * The mod-11 weights, right-to-left cycling 2…9. `slice(-n)` takes the tail so
 * the same table serves the 12-char first pass and the 13-char second.
 */
const CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * A character's numeric contribution: its ASCII code minus 48. Digits `0`–`9`
 * map to 0–9 (identical to the legacy rule, so existing CNPJs keep validating)
 * and letters `A`–`Z` map to 17–42.
 */
function cnpjValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

/** One mod-11 check digit over the first `base.length` characters. */
function cnpjCheckDigit(base: string): number {
  const weights = CNPJ_WEIGHTS.slice(-base.length);
  const sum = [...base].reduce((acc, char, i) => acc + cnpjValue(char) * (weights[i] as number), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Validate a CNPJ's check digits (mod 11), alphanumeric-aware.
 *
 * Rejects the repeated-character sequences (`00000000000000`, `AAAAAAAAAAAA35`)
 * that satisfy the arithmetic but are never issued. Returns false for anything
 * that is not exactly 14 characters with numeric check digits.
 */
export function isValidCnpj(raw: string): boolean {
  const chars = cnpjChars(raw);
  if (chars.length !== CNPJ_LENGTH) return false;
  // Only the 12-character root/establishment may be alphanumeric; the two check
  // digits stay numeric.
  if (!/^\d{2}$/.test(chars.slice(12))) return false;
  if (new Set(chars).size === 1) return false;

  const base = chars.slice(0, 12);
  const first = cnpjCheckDigit(base);
  if (first !== Number(chars[12])) return false;
  return cnpjCheckDigit(`${base}${first}`) === Number(chars[13]);
}

/** Empty ⇒ valid (optional field); otherwise the check digits must match. */
export const cnpj =
  (message = 'CNPJ inválido — confira os dígitos.'): Validator =>
  (value) =>
    value.trim() === '' || isValidCnpj(value) ? undefined : message;

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------

/**
 * Format a Brazilian phone as `(11) 3214-5600` / `(11) 91234-5678`.
 *
 * Both sources that hand us a phone give it as bare concatenated digits — the
 * Receita Federal's `ddd_telefone_1` and an NF-e's `<fone>` — so the same
 * formatting rule serves the CNPJ lookup and the nota importer.
 *
 * Anything that is not a 10- or 11-digit national number is returned trimmed
 * but otherwise untouched: an unrecognized phone (a foreign issuer, an extension
 * appended by the emitter's software) is still better dropped into the field
 * than discarded.
 *
 * @param raw - Digits as the source supplies them, e.g. `1132145600`.
 * @returns The formatted phone, or `null` when there is nothing to format.
 */
export function formatBrPhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) return trimmed;
  const ddd = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  const split = subscriber.length - 4;
  return `(${ddd}) ${subscriber.slice(0, split)}-${subscriber.slice(split)}`;
}
