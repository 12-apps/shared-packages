/**
 * Every sentence the marketplace routes answer a person with. Required, no
 * defaults (the copy-port doctrine): two packs sit beside it (`./pt-BR`,
 * `./en-US`), and a host passes one by hand, or its own.
 *
 * The webhook answers a marketplace's server, not a person, so its bodies are
 * machine codes and need no copy.
 */
export interface MarketplaceServerCopy {
  /** A body, query or path parameter that does not parse. */
  invalidInput: string;
  /** A provider id no adapter is registered for. */
  unknownProvider: string;
  /** The order was decided, lapsed or cancelled since the person looked. */
  orderNoLongerPending: string;
  /** A refusal named a reason that is not the marketplace's. */
  invalidReason: string;
  /** A SKU was pointed at a catalog id that is not this store's. */
  catalogItemNotFound: string;
  /** A save carried nothing to change. */
  nothingToUpdate: string;
}
