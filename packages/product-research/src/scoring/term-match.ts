import { normalizeText, tokenize } from '../normalize/text';
import { volumesDisagree } from './relevance';

/**
 * Term-to-term matching for the "latest research for THIS product" lookup
 * (FUT-430). Unlike `scoreRelevance` (query vs an offer TITLE, threshold
 * 0.95), this matches a product name against PAST RESEARCH TERMS, where the
 * exact-equality filter silently misses renames, accent variants and
 * packaging noise. Three tiers, best first:
 *
 *   exact       — raw case-insensitive equality
 *   normalized  — equal after accent/case/punctuation folding
 *   similar     — every distinctive query word has a (fuzzy) counterpart in
 *                 the candidate, volumes agree, and whole-term trigram
 *                 similarity clears a floor
 *
 * Precision beats recall on purpose: a widget showing an unrelated research
 * launders the wrong price, while a miss just keeps the teaching state. So
 * "Pepsi Lata 350ml" must NOT match "Coca-Cola Lata 350ml" even though plain
 * trigram similarity puts them as close as legitimate renames — the
 * distinctive-word rule is what separates brand/variant differences from
 * packaging noise.
 */

export type TermMatchTier = 'exact' | 'normalized' | 'similar';

export interface TermMatch {
  tier: TermMatchTier;
  /** 1 for the equality tiers; whole-term trigram similarity for `similar`. */
  similarity: number;
}

/**
 * pt-BR words that say HOW a product is sold or shelved, not WHICH product it
 * is — packaging/format plus leading category nouns. Never required to match,
 * so "Coca-Cola LATA 350ml" still finds "Coca-Cola Original 350ml".
 */
const NOISE_WORDS = new Set([
  'lata',
  'latas',
  'latinha',
  'latinhas',
  'latao',
  'latoes',
  'garrafa',
  'garrafas',
  'garrafinha',
  'garrafinhas',
  'fardo',
  'fardos',
  'caixa',
  'caixas',
  'caixinha',
  'caixinhas',
  'engradado',
  'pack',
  'packs',
  'pet',
  'kit',
  'copo',
  'copos',
  'pote',
  'potes',
  'frasco',
  'frascos',
  'galao',
  'galoes',
  'sache',
  'saches',
  'litro',
  'litros',
  'lts',
  'long',
  'neck',
  'unidade',
  'unidades',
  'embalagem',
  'gelada',
  'gelado',
  'cx',
  'retornavel',
  'descartavel',
  'refrigerante',
  'cerveja',
  'bebida',
  'suco',
  'agua',
]);

/** A word carries product identity: not a size/count, not packaging noise. */
const isDistinctive = (token: string): boolean =>
  token.length >= 3 && !/^\d/.test(token) && !NOISE_WORDS.has(token);

/**
 * The identity-bearing words of a term, normalized — what a host prefilters
 * stored terms by (e.g. `term_normalized LIKE %token%`) before scoring
 * candidates with `matchResearchTerm`.
 */
export const distinctiveTermTokens = (term: string): string[] => [
  ...new Set(tokenize(term).filter(isDistinctive)),
];

const wordTrigrams = (word: string): string[] => {
  const padded = `  ${word} `;
  const grams: string[] = [];
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    grams.push(padded.slice(index, index + 3));
  }
  return grams;
};

/** pg_trgm-style trigrams: per word, padded with two spaces front / one back. */
const trigramsOf = (normalized: string): Set<string> =>
  new Set(
    normalized
      .split(' ')
      .filter((word) => word.length > 0)
      .flatMap(wordTrigrams),
  );

const trigramSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/** "lata"/"latas"-grade morphology counts as the same word; "uva"/"laranja" doesn't. */
const WORD_SIMILARITY_FLOOR = 0.5;

/** Below this the terms share too little text to trust, whatever else agrees. */
const TERM_SIMILARITY_FLOOR = 0.3;

const hasCounterpart = (token: string, candidateTokens: string[]): boolean =>
  candidateTokens.some(
    (candidate) =>
      candidate === token ||
      trigramSimilarity(trigramsOf(token), trigramsOf(candidate)) >= WORD_SIMILARITY_FLOOR,
  );

const similarMatch = (query: string, candidateTerm: string): TermMatch | null => {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidateTerm);
  if (volumesDisagree(queryTokens, new Set(candidateTokens))) return null;

  const distinctive = queryTokens.filter(isDistinctive);
  if (distinctive.length === 0) return null;
  if (!distinctive.every((token) => hasCounterpart(token, candidateTokens))) return null;

  const similarity = trigramSimilarity(
    trigramsOf(normalizeText(query)),
    trigramsOf(normalizeText(candidateTerm)),
  );
  return similarity >= TERM_SIMILARITY_FLOOR ? { tier: 'similar', similarity } : null;
};

/** How `query` matches a stored research term, or null when it doesn't. */
export const matchResearchTerm = (query: string, candidateTerm: string): TermMatch | null => {
  if (query.trim().toLowerCase() === candidateTerm.trim().toLowerCase()) {
    return { tier: 'exact', similarity: 1 };
  }
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length === 0) return null;
  if (normalizedQuery === normalizeText(candidateTerm)) {
    return { tier: 'normalized', similarity: 1 };
  }
  return similarMatch(query, candidateTerm);
};

const TIER_RANK: Record<TermMatchTier, number> = { exact: 0, normalized: 1, similar: 2 };

/** Sort comparator: better match first (tier, then similarity). Ties keep input order. */
export const compareTermMatchRank = (a: TermMatch, b: TermMatch): number =>
  TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.similarity - a.similarity;
