import type { CardFieldCopy } from "./copy";
import { formatCpf, isValidCpf } from "./cpf";
import { onlyDigits } from "./format";

/**
 * A payer's document: a CPF, or a CNPJ when the card is a company's.
 *
 * First for the card holder of the owner's activation charge (FUT-4048): an
 * owner paying with the company card (TMF SISTEMAS LTDA, say) has a CNPJ as
 * the holder's document. Then for the BUYER at checkout (FUT-4080): the field
 * at the top of Pagamento took 11 digits only, so a buyer paying with a
 * company card could not type the CNPJ ("Não aceita cnpj", reported from a
 * live storefront on 2026-10-27). PagBank's `customer.tax_id` takes either, as digits, and the
 * gateway's `CPF` field type already validates both by their check digits.
 *
 * One field, told apart by length: up to 11 digits it is read and masked as a
 * CPF, past that as a CNPJ. Numeric CNPJs only — the alphanumeric form the
 * Receita issues from July 2026 is not accepted here yet, because every
 * adapter strips the value to digits before forwarding it.
 */

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

/** Progressive `00.000.000/0000-00` mask for a partially-typed CNPJ. */
function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, CNPJ_LENGTH);
  let out = d.slice(0, 2);
  if (d.length >= 3) out += `.${d.slice(2, 5)}`;
  if (d.length >= 6) out += `.${d.slice(5, 8)}`;
  if (d.length >= 9) out += `/${d.slice(8, 12)}`;
  if (d.length >= 13) out += `-${d.slice(12, 14)}`;
  return out;
}

/** Verify the two CNPJ check digits (rejects all-same-digit sequences too). */
function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== CNPJ_LENGTH) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const checkDigit = (len: number): number => {
    let sum = 0;
    // Weights run 2..9 from the right, then wrap back to 2.
    for (let i = 0; i < len; i += 1) sum += Number(d[len - 1 - i]) * ((i % 8) + 2);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  return checkDigit(12) === Number(d[12]) && checkDigit(13) === Number(d[13]);
}

/** The digits a CPF-or-CNPJ field keeps: at most a CNPJ's fourteen. */
export function taxIdDigits(value: string): string {
  return onlyDigits(value).slice(0, CNPJ_LENGTH);
}

/**
 * The document as a charge carries it: plain digits (FUT-4080), whatever shape
 * the host's pre-fill or an older pack left in the buyer state. `undefined`
 * when there is none, so the body omits it.
 */
export function plainTaxId(value: string | undefined): string | undefined {
  const digits = taxIdDigits(value ?? "");
  return digits === "" ? undefined : digits;
}

/** The CPF mask up to 11 digits, the CNPJ mask past them. */
export function formatCpfOrCnpj(value: string): string {
  const d = taxIdDigits(value);
  return d.length <= CPF_LENGTH ? formatCpf(d) : formatCnpj(d);
}

/** Whether `value` is a valid CPF (11 digits) or a valid CNPJ (14), by their check digits. */
export function isValidCpfOrCnpj(value: string): boolean {
  const d = onlyDigits(value);
  return isValidCpf(d) || isValidCnpj(d);
}

/**
 * Whether a partly typed document is still SHORT of either length: under a
 * CPF's 11 digits, or between them and a CNPJ's 14. A value at 11 or 14 digits
 * is complete, valid or not.
 */
export function isIncompleteCpfOrCnpj(value: string): boolean {
  const length = onlyDigits(value).length;
  return length < CPF_LENGTH || (length > CPF_LENGTH && length < CNPJ_LENGTH);
}

/** Which document a value holds, read by its length — `null` while it is neither. */
export function taxIdKind(value: string | undefined): "CPF" | "CNPJ" | null {
  const length = onlyDigits(value ?? "").length;
  if (length === CPF_LENGTH) return "CPF";
  if (length === CNPJ_LENGTH) return "CNPJ";
  return null;
}

/** Field validator for a CPF or a CNPJ: an error message, or `undefined` when valid. */
export function validateCpfOrCnpj(value: string, copy: CardFieldCopy): string | undefined {
  const d = onlyDigits(value);
  if (!d) return copy.taxIdRequired;
  return isValidCpfOrCnpj(d) ? undefined : copy.taxIdInvalid;
}
