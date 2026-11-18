/**
 * PagBank request bodies shared by the adapter's create paths, split out of
 * `pagbank.ts` for its 400-line ceiling (same seam as `pagbank-snapshots.ts`,
 * which maps the answers).
 */
import type { PagbankCopy } from './copy';
import type { ChargeInput, ResolvedCredentials } from '../core/types';
import { customerPayload, notificationUrls } from './pagbank-http';
import { chargeDescription } from './shared';
import { fiscalSplitFieldsOf, type FiscalSplitFields } from '../core/fiscal-split';

/**
 * The one summary line the Orders API requires; its amount equals the total
 * (line-item detail stays in the host's DB).
 */
export function summaryItems(input: ChargeInput, copy: PagbankCopy) {
  return [
    { reference_id: input.reference, name: copy.payer.lineItemName, quantity: 1, unit_amount: input.amount.amountCents },
  ];
}

/**
 * A PIX order in the charge form PagBank homologates (FUT-3928, "Criar pedido
 * com QR Code PIX v2"): the QR rides `charges[].payment_method.pix` and comes
 * back as `charges[].qr_code`. The order-level `qr_codes[]` this used to send
 * is the form PagBank's integration team asked us to stop testing with.
 */
export function pixPayload(
  input: ChargeInput,
  credentials: ResolvedCredentials,
  copy: PagbankCopy,
  expiresAt: string,
  fiscalSplitFields?: FiscalSplitFields,
) {
  return {
    reference_id: input.reference,
    customer: customerPayload(input.customer),
    items: summaryItems(input, copy),
    charges: [
      {
        reference_id: input.reference,
        description: chargeDescription(input, 64),
        amount: { value: input.amount.amountCents, currency: input.amount.currency },
        payment_method: { type: 'PIX', pix: { expiration_date: expiresAt } },
        // The split payment's informed tax (FUT-2239): sent ONLY under the
        // `'stub'` field set until PagBank publishes its own, and never on
        // PRODUCTION credentials (the stub names are unofficial); else nothing.
        ...fiscalSplitFieldsOf(
          input.fiscalSplit,
          credentials.environment === 'PRODUCTION' ? 'none' : fiscalSplitFields,
        ),
      },
    ],
    notification_urls: notificationUrls(credentials),
  };
}

/** How a host builds the PagBank adapter (`pagbankProvider(copy, options)`). */
export interface PagbankOptions {
  /**
   * The wire form of `ChargeInput.fiscalSplit` (FUT-2239). Absent or `'none'`:
   * never sent, and the adapter declares no `splitArrangements`. `'stub'`: the
   * CGIBS field set, for homologação rehearsal only — written on SANDBOX
   * credentials alone, and the only build that declares `PIX_DINAMICO`.
   */
  fiscalSplitFields?: FiscalSplitFields;
}
