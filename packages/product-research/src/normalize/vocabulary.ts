/**
 * The words this package READS in a merchant's own data (FUT-760).
 *
 * Not copy — nothing here is ever rendered. It is the opposite direction: the
 * spellings a parser has to recognise in text somebody else wrote. A stock
 * badge, a delivery line, a supplier's spreadsheet header.
 *
 * That makes it just as unportable as copy, and less visibly so. A host in
 * another market gets a package that RUNS — no error, no missing prop — and
 * silently reports `undefined` availability for every offer, unknown shipping
 * on every free-delivery banner, and a spreadsheet whose columns it cannot
 * find. The failure is a quiet, total loss of signal, which is why the
 * vocabulary is required and has no default.
 *
 * Regexes rather than word lists, because these are matched against
 * free-running merchant prose where "não disponível" must not read as
 * available through its own suffix. A market pack states its own patterns and
 * its own precedence; this package only states WHICH questions it asks of the
 * text.
 */

/** A column a price spreadsheet can carry, whatever it is headed. */
export type MappableField =
  | 'title'
  | 'price'
  | 'supplierName'
  | 'brand'
  | 'ean'
  | 'packQuantity'
  | 'validUntil';

/** How a market's merchants say things this package needs to understand. */
export interface MarketVocabulary {
  /**
   * The item cannot be bought right now. Tested BEFORE {@link inStock}, so a
   * pack may write the negative as a plain alternation without having to
   * out-specify its own positive.
   */
  outOfStock: RegExp;
  /** The item is available. */
  inStock: RegExp;
  /**
   * An unconditional free-delivery claim, matched against
   * `normalizeText` output — so a pack writes the unaccented, lower-case form
   * and covers every casing and both spellings a vendor may send.
   */
  freeDelivery: RegExp;
  /**
   * A free-delivery claim gated on a basket minimum ("above R$ 79"). Free for
   * an order this research is not pricing, so the honest answer is unknown.
   */
  conditionalFree: RegExp;
  /**
   * A financing term ("12x", "sem juros"). A delivery line quoting one states
   * nothing about freight, and reading it as freight reports a financing
   * figure as a shipping cost the merchant never quoted.
   */
  installment: RegExp;
  /** A delivery promise naming today. */
  sameDay: RegExp;
  /** A delivery promise naming tomorrow. */
  nextDay: RegExp;
  /**
   * Spreadsheet header spellings recognised without an explicit mapping.
   * Compared after the importer's own accent-stripping, so a pack may list
   * either spelling (or both, harmlessly).
   */
  headerAliases: Record<MappableField, readonly string[]>;
}
