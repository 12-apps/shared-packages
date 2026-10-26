import type { CardFieldCopy } from "./copy";
import { formatCpf, isValidCpf } from "./cpf";
import { onlyDigits } from "./format";

/**
 * A card holder's document: a CPF, or a CNPJ when the card is a company's
 * (FUT-4048).
 *
 * The owner's R$ 1,00 activation charge is paid with the owner's own card, and
 * an owner paying with the company card (TMF SISTEMAS LTDA, say) has a CNPJ as
 * the holder's document — the CPF-only field refused it and blocked the
 * activation. PagBank's `customer.tax_id` takes either, as digits.
 *
 * One field, told apart by length: up to 11 digits it is read and masked as a
 * CPF, past that as a CNPJ. Numeric CNPJs only — the alphanumeric form the
 * Receita issues from July 2026 is not accepted here yet.
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

/** The CPF mask up to 11 digits, the CNPJ mask past them. */
export function formatCpfOrCnpj(value: string): string {
  const d = taxIdDigits(value);
  return d.length <= CPF_LENGTH ? formatCpf(d) : formatCnpj(d);
}

/** Field validator for a CPF or a CNPJ: an error message, or `undefined` when valid. */
export function validateCpfOrCnpj(value: string, copy: CardFieldCopy): string | undefined {
  const d = onlyDigits(value);
  if (!d) return copy.taxIdRequired;
  return isValidCpf(d) || isValidCnpj(d) ? undefined : copy.taxIdInvalid;
}
