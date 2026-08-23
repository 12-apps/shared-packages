import type { RawOffer } from '../types';

import type { MarketVocabulary } from './vocabulary';

/**
 * Deterministic availability from free-text merchant signals (tags, delivery
 * notes, "Restam apenas 3 em estoque" lines). Negative signals are checked
 * FIRST so "não disponível" never reads as available through its "disponível"
 * suffix. No signal at all stays undefined — the absence of a claim is not
 * stock.
 *
 * The words are the MARKET's (FUT-760): they used to be two regexes compiled
 * into this module, so a host outside Brazil got a reader that recognised
 * nothing and reported every offer as unknown — silently, because unknown is
 * also the honest answer when a merchant says nothing.
 */
export const availabilityFromText = (
  texts: readonly (string | null | undefined)[],
  vocabulary: Pick<MarketVocabulary, 'outOfStock' | 'inStock'>,
): RawOffer['availability'] => {
  const text = texts.filter((entry): entry is string => Boolean(entry)).join(' ');
  if (vocabulary.outOfStock.test(text)) return 'OUT_OF_STOCK';
  if (vocabulary.inStock.test(text)) return 'IN_STOCK';
  return undefined;
};
