/**
 * PagBank request bodies shared by the adapter's create paths, split out of
 * `pagbank.ts` for its 400-line ceiling (same seam as `pagbank-snapshots.ts`,
 * which maps the answers).
 */
import type { PagbankCopy } from './copy';
import type { ChargeInput, ResolvedCredentials } from '../core/types';
import { customerPayload, notificationUrls } from './pagbank-http';
import { chargeDescription } from './shared';

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
export function pixPayload(input: ChargeInput, credentials: ResolvedCredentials, copy: PagbankCopy, expiresAt: string) {
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
      },
    ],
    notification_urls: notificationUrls(credentials),
  };
}
