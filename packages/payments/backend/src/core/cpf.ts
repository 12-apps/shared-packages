/**
 * CPF (Brazilian taxpayer id) validation — the server half.
 *
 * Brazilian acquirers require the payer's CPF (`customer.tax_id`) on a
 * charge, so a host validates it wherever a buyer identity is written. The
 * mod-11 double check digit is pure mechanism with zero host knowledge — it
 * had one copy in `payments-frontend`'s card form and a second hand-rolled in
 * the first adopting host's server code, which is exactly the drift this
 * module ends. Formatting (the progressive mask) stays frontend-side where
 * the keystrokes are; a server only ever needs the verdict.
 */

/** Strip everything but digits. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Verify the two CPF check digits (rejects all-same-digit sequences too). */
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
