import type { SettingsService } from '../config/service';
import type { MerchantRef } from '../core/types';
import { parseVerificationReference } from './reference';

/**
 * Settle an activation charge named by a webhook, if that is what this is.
 *
 * Returns whether it handled the event. Hosts call it first in their
 * `onWebhookEvent` handler: the activation charge is raised through the
 * adapter directly, so it has no stored charge and no order behind it — and a
 * guard that drops events with no stored charge would drop this one silently.
 *
 * The reference is `verify-<provider>-<merchantId>` and it arrives INSIDE the
 * payload, so BOTH halves are an anonymous caller's claim. Each is checked
 * against something the payload cannot forge:
 *
 *   - `merchantId` against `merchant` — the account the delivery was VERIFIED
 *     for, resolved from the URL and the credential store. A forged
 *     `order_nsu` cannot switch on somebody else's connection.
 *   - `provider` against `deliveredBy` — the adapter that actually verified
 *     this delivery. Without it, a REAL R$1,01 paid through InfinitePay with
 *     `order_nsu=verify-pagbank-<merchantId>` would verify via InfinitePay
 *     and then stamp PAGBANK as charge-proven — activating a provider no
 *     charge ever passed through, which is the exact assertion FUT-463 exists
 *     to prevent. A proof is only a proof of the rail it rode on.
 *
 * TENANT merchants only: activation charges are minted by the settings
 * surface for a tenant's own connection, so a reference that resolves to any
 * other merchant kind is not an activation charge, whatever it claims.
 */
export async function settleActivationCharge(
  settings: Pick<SettingsService, 'applyChargeVerification'>,
  reference: string,
  merchant: MerchantRef,
  deliveredBy: string,
): Promise<boolean> {
  const parsed = parseVerificationReference(reference);
  if (!parsed) return false;
  const { provider, merchantId } = parsed;
  if (provider !== deliveredBy) return false;
  if (merchant.kind !== 'TENANT' || merchant.id !== merchantId) return false;

  await settings.applyChargeVerification(merchant, provider, true);
  return true;
}
