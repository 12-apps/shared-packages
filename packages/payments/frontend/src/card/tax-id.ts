import type { CardFieldCopy } from "./copy";
import { formatCpf, isValidCpf } from "./cpf";

/**
 * A payer's document: a CPF, or a CNPJ when the card is a company's.
 *
 * First for the card holder of the owner's activation charge (FUT-4048): an
 * owner paying with the company card (TMF SISTEMAS LTDA, say) has a CNPJ as
 * the holder's document. Then for the BUYER at checkout (FUT-4080): the field
 * at the top of Pagamento took 11 digits only, so a buyer paying with a
 * company card could not type the CNPJ ("Não aceita cnpj", reported from a
 * live storefront on 2026-10-27).
 *
 * One field, told apart by length and shape: up to 11 digits it is read and
 * masked as a CPF; past that, or from its first letter, as a CNPJ. The CNPJ
 * may be ALPHANUMERIC (FUT-590): from July 2026 the Receita issues CNPJs whose
 * first 12 characters may be `A-Z` (IN RFB nº 2.229/2024), masked
 * `AA.AAA.AAA/AAAA-DD`, kept uppercased, and checked by the same mod-11 with
 * each character worth its ASCII code minus 48. A CPF stays digits only.
 *
 * The rule MIRRORS `@12-apps/payments-backend`'s `core/tax-id.ts`, which the
 * buyer gate and a host's server read: this package may import only types from
 * there (ADOPTING.md §6). `components/checkout/__tests__/tax-id.contract.test.ts`
 * runs both over one table, so the field cannot take a document the gate
 * refuses, nor refuse one it takes.
 */

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;
const ONE_CHARACTER_REPEATED = /^(.)\1+$/;
const CHARACTER_ZERO = 48;

/**
 * The document's characters: digits and uppercased letters, punctuation and
 * spaces dropped — and NOTHING cut, so a value longer than a CNPJ's fourteen
 * is measured, and refused, as what it is. Mirrors the server's.
 */
export function taxIdCharacters(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * How a value is READ before any rule sees it (FUT-590): Unicode NFKC, so
 * fullwidth digits and slashes are ASCII and `º` is `o`; then NFD with every
 * combining mark dropped, so `É` is `E`; then uppercased.
 */
const COMBINING_MARKS = /\p{M}/gu;

function normalise(value: string): string {
  return value.normalize("NFKC").normalize("NFD").replace(COMBINING_MARKS, "").toUpperCase();
}

/** What a keystroke, or a paste of the field's own masked value, can hold. */
const TYPED_SHAPE = /^[0-9A-Z./-]*$/;

/** A CPF/CNPJ label word in front of more characters ("CPF529.982.247-25", "CNPJ/MF"). */
const LEADING_LABEL = /^(CNPJ|CPF)(?=[0-9A-Z./-])/;

/** One TOKEN of a paste: a maximal run of the mask's own characters. */
const TOKEN = /[0-9A-Z./-]+/g;

/** An alphanumeric CNPJ's shape: fourteen characters, a letter among them, ending in two digits. */
function isAlphanumericCnpjShaped(kept: string): boolean {
  return kept.length === CNPJ_LENGTH && /[A-Z]/.test(kept) && /\d{2}$/.test(kept);
}

/**
 * What a CPF-or-CNPJ field kept before FUT-590: every digit, nothing else,
 * capped at fourteen. Labels, names, phones, marks and spaces all fall away.
 */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, CNPJ_LENGTH);
}

/**
 * The PASTE path. The digits-only reading is kept unless an alphanumeric CNPJ
 * is clearly there (FUT-590):
 *
 *  a. the digits alone are a valid CPF or numeric CNPJ → those digits;
 *  b. else the first token whose characters are a valid alphanumeric CNPJ;
 *  c. else the first token shaped like one (fourteen characters, a letter,
 *     two final digits) — a typo the buyer sees in their own letters;
 *  d. else the digits alone, as the field always read them.
 */
function pastedDocument(value: string): string {
  const digits = digitsOnly(value);
  if (isValidCpfOrCnpj(digits)) return digits;
  const shaped = (value.match(TOKEN) ?? []).map(taxIdCharacters).filter(isAlphanumericCnpjShaped);
  return shaped.find(isValidCnpj) ?? shaped[0] ?? digits;
}

/**
 * What the FIELD keeps as the buyer types or pastes. TYPING — no space, only
 * the mask's own characters, not led by a label word — is kept as typed, so a
 * partial alphanumeric CNPJ ("12ABC") keeps its letters; anything else is a
 * paste, read by {@link pastedDocument}. Capped at a CNPJ's fourteen, the most
 * a document has. Only the input path drops and caps; every check measures
 * what it is given.
 */
export function taxIdInput(value: string): string {
  const normalised = normalise(value);
  const typed = TYPED_SHAPE.test(normalised) && !LEADING_LABEL.test(normalised);
  return typed ? taxIdCharacters(normalised).slice(0, CNPJ_LENGTH) : pastedDocument(normalised);
}

/** Whether the kept characters are a CPF on its way: digits only, at most eleven. */
function isCpfShaped(kept: string): boolean {
  return kept.length <= CPF_LENGTH && /^\d*$/.test(kept);
}

/** Progressive `AA.AAA.AAA/AAAA-DD` mask for a partially-typed CNPJ, numeric or alphanumeric. */
function formatCnpj(kept: string): string {
  let out = kept.slice(0, 2);
  if (kept.length >= 3) out += `.${kept.slice(2, 5)}`;
  if (kept.length >= 6) out += `.${kept.slice(5, 8)}`;
  if (kept.length >= 9) out += `/${kept.slice(8, 12)}`;
  if (kept.length >= 13) out += `-${kept.slice(12, 14)}`;
  return out;
}

/** One CNPJ check digit over `base`: weights 2..9 from the right, wrapping back to 2. */
function cnpjCheckDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    sum += (base.charCodeAt(base.length - 1 - i) - CHARACTER_ZERO) * ((i % 8) + 2);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** A valid CNPJ, numeric or alphanumeric, by its two check digits; one character repeated is refused. */
function isValidCnpj(kept: string): boolean {
  if (!CNPJ_SHAPE.test(kept) || ONE_CHARACTER_REPEATED.test(kept)) return false;
  const first = cnpjCheckDigit(kept.slice(0, 12));
  const second = cnpjCheckDigit(kept.slice(0, 12) + String(first));
  return kept[12] === String(first) && kept[13] === String(second);
}

/**
 * The document as a charge carries it: its characters without punctuation
 * (FUT-4080, FUT-590), whatever shape the host's pre-fill or an older pack left
 * in the buyer state. `undefined` when there is none, so the body omits it.
 */
export function plainTaxId(value: string | undefined): string | undefined {
  const kept = taxIdCharacters(value ?? "");
  return kept === "" ? undefined : kept;
}

/** The CPF mask while it is one, the CNPJ mask past eleven digits or from its first letter. */
export function formatCpfOrCnpj(value: string): string {
  const kept = taxIdInput(value);
  return isCpfShaped(kept) ? formatCpf(kept) : formatCnpj(kept);
}

/** Whether `value` is a valid CPF (11 digits) or a valid CNPJ (14 characters), by their check digits. */
export function isValidCpfOrCnpj(value: string): boolean {
  const kept = taxIdCharacters(value);
  if (kept.length === CPF_LENGTH) return /^\d+$/.test(kept) && isValidCpf(kept);
  return isValidCnpj(kept);
}

/**
 * Whether a partly typed document is still SHORT of either length: under a
 * CPF's 11 digits, or between them and a CNPJ's 14 — and, once it carries a
 * letter, short of a CNPJ's 14. A value at 11 digits or 14 characters is
 * complete, valid or not.
 */
export function isIncompleteCpfOrCnpj(value: string): boolean {
  const kept = taxIdCharacters(value);
  if (!isCpfShaped(kept)) return kept.length < CNPJ_LENGTH;
  return kept.length < CPF_LENGTH;
}

/**
 * Which document a value holds, read by its length and shape — `null` while it
 * is neither. Eleven characters with a letter among them are a CNPJ on its way.
 */
export function taxIdKind(value: string | undefined): "CPF" | "CNPJ" | null {
  const kept = taxIdCharacters(value ?? "");
  if (kept.length === CPF_LENGTH && /^\d+$/.test(kept)) return "CPF";
  if (kept.length === CNPJ_LENGTH) return "CNPJ";
  return null;
}

/** Field validator for a CPF or a CNPJ: an error message, or `undefined` when valid. */
export function validateCpfOrCnpj(value: string, copy: CardFieldCopy): string | undefined {
  if (!taxIdCharacters(value)) return copy.taxIdRequired;
  return isValidCpfOrCnpj(value) ? undefined : copy.taxIdInvalid;
}
