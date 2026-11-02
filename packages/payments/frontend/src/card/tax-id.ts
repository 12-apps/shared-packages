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
 * The characters a CPF-or-CNPJ field keeps: digits and uppercased letters, at
 * most a CNPJ's fourteen — what the buyer state, the charge and "Salvar meus
 * dados" carry.
 */
export function taxIdCharacters(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, CNPJ_LENGTH);
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
  const kept = taxIdCharacters(value);
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
