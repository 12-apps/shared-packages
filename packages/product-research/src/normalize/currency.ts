/**
 * BRL gate shared by the Brazil-pinned paid connectors, conservative and
 * deterministic: the request pins Brazil, so BRL is the ambient currency —
 * but marketplaces leak cross-border listings. An explicit non-BRL currency
 * code, or a price text naming another currency (a bare "$", "US$", "€", …),
 * fails the gate; a result with neither claim passes.
 */
export const isBrlPrice = (
  currency: string | null | undefined,
  priceText: string | null | undefined,
): boolean => {
  if (currency) return currency.trim().toUpperCase() === 'BRL';
  if (!priceText) return true;
  if (/R\$/.test(priceText)) return true;
  return !/[$€£¥]|\bUSD\b|\bEUR\b|\bGBP\b/i.test(priceText);
};
