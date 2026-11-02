/**
 * A payer's document — a CPF, or a CNPJ, numeric or ALPHANUMERIC — read and
 * checked through ONE rule on the server (FUT-590).
 *
 * The Receita Federal issues alphanumeric CNPJs from July 2026 (IN RFB nº
 * 2.229/2024): the first 12 characters are `0-9` or `A-Z`, the last two are
 * still numeric check digits, and the old all-numeric CNPJs stay valid. The
 * check digits are the same mod-11 as before, with every character worth its
 * ASCII code minus 48 — so a digit keeps its value and `A` is 17.
 *
 * A CPF stays digits only.
 *
 * This package's buyer gate, its adapters and a host's server read the
 * document through these functions. The browser field mirrors them in
 * `payments-frontend`'s `card/tax-id.ts` — the frontend may import only types
 * from here (ADOPTING.md §6) — and `tax-id.contract.test.ts` there runs both
 * over one table, so the field cannot take a document this gate refuses.
 */
import { isValidCpf } from './cpf';

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;
const ONE_CHARACTER_REPEATED = /^(.)\1+$/;
const CHARACTER_ZERO = 48;

/**
 * The document as it is kept and sent: its letters uppercased, every mark of
 * punctuation and space dropped, at most a CNPJ's fourteen characters.
 */
export function taxIdCharacters(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CNPJ_LENGTH);
}

/** Whether the document carries a letter — an alphanumeric CNPJ, or one on its way. */
export function taxIdHasLetters(value: string): boolean {
  return /[A-Z]/.test(taxIdCharacters(value));
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

/**
 * Whether `value` is a valid CNPJ, numeric or alphanumeric, by its two check
 * digits. One character repeated fourteen times is refused, as the Receita
 * never issues one.
 */
export function isValidCnpj(value: string): boolean {
  const kept = taxIdCharacters(value);
  if (!CNPJ_SHAPE.test(kept) || ONE_CHARACTER_REPEATED.test(kept)) return false;
  const first = cnpjCheckDigit(kept.slice(0, 12));
  const second = cnpjCheckDigit(kept.slice(0, 12) + String(first));
  return kept[12] === String(first) && kept[13] === String(second);
}

/** Eleven digits and nothing else: the only shape a CPF has. */
function isCpfShaped(kept: string): boolean {
  return kept.length === CPF_LENGTH && /^\d+$/.test(kept);
}

/** Whether `value` is a valid CPF (11 digits) or a valid CNPJ (14 characters). */
export function isValidCpfOrCnpj(value: string): boolean {
  const kept = taxIdCharacters(value);
  if (kept.length === CPF_LENGTH) return isCpfShaped(kept) && isValidCpf(kept);
  return isValidCnpj(kept);
}

/**
 * Which document a value holds, read by its length and shape — `null` while it
 * is neither. Eleven characters with a letter among them are a CNPJ on its way.
 */
export function taxIdKind(value: string | null | undefined): 'CPF' | 'CNPJ' | null {
  const kept = taxIdCharacters(value ?? '');
  if (isCpfShaped(kept)) return 'CPF';
  if (kept.length === CNPJ_LENGTH) return 'CNPJ';
  return null;
}
