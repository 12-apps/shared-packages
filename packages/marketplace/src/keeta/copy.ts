import { OPEN_DELIVERY_MERCHANT_REASON_CODES } from "../open-delivery/reasons";

/**
 * The words the Keeta adapter needs from its host, and nothing else.
 *
 * Required and defaultless, like every copy port in this repo: the adapter
 * ships no language of its own. Two packs sit beside it (`./pt-BR`,
 * `./en-US`); a host passes one by hand, or its own.
 */

/**
 * The cancellation codes a merchant may send: Keeta's "códigos de
 * cancelamento (v1.0.7+)", the same eleven as Open Delivery's
 * (`../open-delivery/reasons.ts`). Keeta still accepts its legacy codes
 * (`INSUFFICIENT_DISHES`, `SUSPENSION_OF_BUSINESS`, `INSUFFICIENT_MANPOWER`,
 * `OTHERS`) and recommends the new ones, so only the new ones are offered.
 */
export const KEETA_REASON_CODES = OPEN_DELIVERY_MERCHANT_REASON_CODES;

export type KeetaReasonCode = (typeof KEETA_REASON_CODES)[number];

export interface KeetaAdapterCopy {
  /** One label per reason code. Sent as the request's `reason` text when the store wrote none. */
  reasonLabels: Readonly<Record<KeetaReasonCode, string>>;
  /** What an address with no street number (or an encrypted one Keeta would not reveal) says instead. */
  missingStreetNumber: string;
}
