/**
 * The words the iFood adapter needs from its host, and nothing else.
 *
 * Required and defaultless, like every copy port in this repo: the adapter
 * ships no language of its own. Two packs sit beside it (`./pt-BR`,
 * `./en-US`); a host passes one by hand, or its own.
 */

/**
 * iFood's documented cancellation reason codes. UNVERIFIED: read from the
 * merchant portal's search snippets (2026-11-11), not from a page we could
 * read whole; the homologation run against iFood's sandbox corrects them here.
 */
export const IFOOD_REASON_CODES = [
  "501",
  "502",
  "503",
  "504",
  "505",
  "506",
  "507",
  "508",
  "509",
  "511",
  "512",
  "513",
] as const;

export type IfoodReasonCode = (typeof IFOOD_REASON_CODES)[number];

export interface IfoodAdapterCopy {
  /** One label per reason code. Sent to iFood as the reason text when the store wrote none. */
  reasonLabels: Readonly<Record<IfoodReasonCode, string>>;
  /** What an address with no street number says instead. */
  missingStreetNumber: string;
}
