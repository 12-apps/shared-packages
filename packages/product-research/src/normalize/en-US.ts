import type { MarketVocabulary } from './vocabulary';

/**
 * The English-speaking market's pack — a NAMED constant a host passes by hand.
 *
 * This one is NOT a translation, and the difference matters. A
 * {@link MarketVocabulary} is how a listing in one MARKET says "out of stock"
 * or "free delivery" — it parses somebody else's HTML, so its patterns are
 * facts about how those storefronts write, not about which language the reader
 * of our screens prefers. A Brazilian store selling to an English-reading buyer
 * still writes "esgotado", and that buyer still needs the pt-BR pack; what
 * selects between these is the market being searched, not the reader.
 *
 * That is also why it is honest about its own standing: these patterns cover
 * the phrasings common to English-language storefronts, category for category
 * with the Brazilian pack, and a host adopting them should MEASURE them against
 * the sources it actually searches before relying on the availability flags. An
 * under-matching `outOfStock` does not fail loudly — it quietly reports stock
 * the store does not have, which is the one error here a buyer acts on.
 *
 * The `headerAliases` half is different again: it reads a spreadsheet the store
 * owner uploaded, so English column names are the whole of what is needed, and
 * every alias the pt-BR pack carries in English (`product`, `title`, `price`,
 * `supplier`, `brand`, `ean`, `gtin`, `barcode`, `pack`, `valid until`) is
 * already here.
 */
export const EN_US_MARKET_VOCABULARY: MarketVocabulary = {
  outOfStock: /out of stock|sold out|unavailable|no longer available|currently unavailable/i,
  inStock: /in stock|available now|ready to ship|available/i,
  // Unaccented and lower-cased by the caller before matching, matching how the
  // pt-BR pack is written.
  freeDelivery: /(?:free)\s+(?:delivery|shipping|postage)/,
  conditionalFree: /\b(?:over|above|from|orders? over|minimum|spend)\b/,
  installment: /\d+\s*x\b|interest[- ]free|installments?|instalments?/i,
  sameDay: /\btoday\b|\bsame[- ]day\b/,
  nextDay: /\btomorrow\b|\bnext[- ]day\b/,
  headerAliases: {
    title: ['product', 'description', 'item', 'name', 'title'],
    price: ['price', 'unit price', 'amount', 'value', 'cost'],
    supplierName: ['supplier', 'distributor', 'vendor', 'seller'],
    brand: ['brand', 'make'],
    ean: ['ean', 'gtin', 'barcode', 'bar code', 'upc'],
    packQuantity: ['pack', 'pack size', 'units per case', 'case qty', 'qty per case'],
    validUntil: ['valid until', 'expiry', 'expires', 'valid to', 'best before'],
  },
};
