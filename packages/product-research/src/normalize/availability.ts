import type { RawOffer } from '../types';

const OUT_OF_STOCK = /esgotado|fora de estoque|sem estoque|n[ãa]o dispon[ií]vel|indispon[ií]vel/i;
const IN_STOCK = /em estoque|pronta entrega|dispon[ií]vel/i;

/**
 * Deterministic pt-BR availability from free-text merchant signals (tags,
 * delivery notes, "Restam apenas 3 em estoque" lines). Negative signals are
 * checked FIRST so "não disponível" never reads as available through its
 * "disponível" suffix. No signal at all stays undefined — the absence of a
 * claim is not stock.
 */
export const availabilityFromText = (
  texts: readonly (string | null | undefined)[],
): RawOffer['availability'] => {
  const text = texts.filter((entry): entry is string => Boolean(entry)).join(' ');
  if (OUT_OF_STOCK.test(text)) return 'OUT_OF_STOCK';
  if (IN_STOCK.test(text)) return 'IN_STOCK';
  return undefined;
};
