import type { CustomerFieldKey, PaymentMethodKind } from '../core/types';

/**
 * EVERY buyer-facing sentence the checkout can produce, as a port (FUT-740).
 *
 * The library decides WHICH code fires, at what status, and in what order —
 * those are the money-safety rules, and they stay here. The WORDS are the
 * host's, because baking pt-BR product copy into a published package makes it
 * unportable to any host that is not this one storefront, and because a
 * sentence is a product decision a library has no standing to make.
 *
 * What the library still enforces through this seam is exactly what the copy
 * exists for: an exhausted chain gets ONE honest sentence and never the last
 * provider's words; an unresolved charge is worded so it cannot invite a second
 * payment. A host can change the wording; it cannot change which of those two
 * situations it is being asked to word.
 *
 * THE pt-BR TABLE THAT USED TO SIT BELOW THIS INTERFACE IS GONE, and the
 * docstring above is why. `defaultCheckoutCopyPtBR` shipped one storefront's
 * sentences — its own header said "the strings future-pay's checkout serves
 * today, verbatim" — inside the package every other adopter installs. It was
 * never read by anything in here, so it cost nothing to remove and bought
 * nothing while it stayed: an export that only ever hands a second host a
 * first host's product voice. Copy is the HOST's, entire; the port above is
 * how it arrives, and there is now no way to skip supplying it.
 */
export interface CheckoutCopy {
  /** No provider is connected — the merchant cannot take payment at all. */
  notConfigured: string;
  /**
   * The whole chain refused. NAMED BY METHOD, never by "payment methods": in a
   * storefront that phrase is the buyer's word for the tiles in the picker, so
   * "none of this store's payment methods worked" told a shopper whose CARD
   * charge exhausted the chain that PIX would not work either — and a chain can
   * exhaust on CARD purely because no instrument was minted for its tail while
   * every provider in it still charges PIX fine.
   */
  chainExhausted(method: PaymentMethodKind): string;
  /**
   * A charge NOBODY can confirm yet. Must not invite a second payment — some
   * provider may be holding the money — and must not promise something the
   * screen does not do.
   */
  unresolvedCharge: string;
  /** The charge that came back is not this attempt's; nothing was recorded. */
  chargeMismatch: string;
  /** A saved instrument this merchant/provider pair cannot charge (FUT-697). */
  instrumentNotUsableHere: string;
  /** No payable under that handle — or not this caller's. Indistinguishable. */
  payableNotFound: string;
  /** One or more buyer fields are absent (FUT-595). */
  buyerFieldMissing(fields: readonly CustomerFieldKey[]): string;
  /** A buyer field is present but the provider will not accept it. */
  buyerFieldInvalid(field: CustomerFieldKey): string;
  /**
   * The `field` value the CLIENT highlights for a buyer field — the wire name,
   * which is a host/client contract rather than a library one (`taxId` is
   * `cpf` in a Brazilian storefront).
   */
  fieldNameOf(field: CustomerFieldKey): string;
  /** Nothing more specific applies. Never a provider's own sentence. */
  genericProviderRefusal: string;
}
