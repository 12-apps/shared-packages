import type { CardFieldCopy } from "./copy";
import { onlyDigits } from "./format";

/**
 * CPF (Brazilian taxpayer id) formatting + validation.
 *
 * PagBank requires the payer's CPF (`customer.tax_id`) on every PIX/card charge
 * — the shopper's at checkout, and the owner's on the R$0,01 charge that proves
 * their provider works (FUT-463). It is sent to PagBank as digits and — by
 * design — never persisted in our database (data minimization).
 */

/** Progressive `000.000.000-00` mask for a partially-typed CPF. */
export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  let out = d.slice(0, 3);
  if (d.length >= 4) out += `.${d.slice(3, 6)}`;
  if (d.length >= 7) out += `.${d.slice(6, 9)}`;
  if (d.length >= 10) out += `-${d.slice(9, 11)}`;
  return out;
}

/**
 * Verify the two CPF check digits (rejects all-same-digit sequences too).
 *
 * Exported as the PREDICATE beside {@link validateCpf}'s sentence, because a
 * caller that only needs the verdict should not have to hold the words to get
 * it — `buyer-fields.ts` gates a field on this and threw the message away.
 */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const checkDigit = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return checkDigit(9) === Number(d[9]) && checkDigit(10) === Number(d[10]);
}

/** Field validator: returns an error message, or `undefined` when valid. */
export function validateCpf(value: string, copy: CardFieldCopy): string | undefined {
  if (!onlyDigits(value)) return copy.cpfRequired;
  return isValidCpf(value) ? undefined : copy.cpfInvalid;
}
