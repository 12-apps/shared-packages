/**
 * Accent/case-insensitive normalization for pt-BR product matching. Mirrors
 * the host's `normalizeSearchText` behaviour but lives in-package so the
 * scorer has zero host imports.
 */
export const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9,.]+/g, ' ')
    .trim();

/**
 * Tokens for matching. Volume/pack tokens are canonicalized so "350 ml",
 * "350ml" and "0,35l" agree, and decimal commas survive as part of the number.
 */
export const tokenize = (value: string): string[] => {
  const joined = normalizeText(value)
    // "350 ml" / "2,5 l" → "350ml" / "2,5l" so a volume is always one token.
    .replace(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|un|und|unidades?)\b/g, '$1$2');
  return joined
    .split(' ')
    .map((token) => token.replace(/^[,.]+|[,.]+$/g, ''))
    .filter((token) => token.length > 0);
};

const ML_PER_L = 1000;

/** A volume token ("350ml", "2,5l") in millilitres, or null. */
export const volumeTokenToMl = (token: string): number | null => {
  const match = /^(\d+(?:[.,]\d+)?)(ml|l)$/.exec(token);
  const [, rawAmount, unit] = match ?? [];
  if (rawAmount === undefined) return null;
  const amount = Number(rawAmount.replace(',', '.'));
  if (Number.isNaN(amount)) return null;
  return unit === 'l' ? Math.round(amount * ML_PER_L) : Math.round(amount);
};
