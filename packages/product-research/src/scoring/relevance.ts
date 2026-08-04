import { tokenize, volumeTokenToMl } from '../normalize/text';

export interface RelevanceInput {
  term: string;
  brand?: string;
  ean?: string;
}

export interface OfferText {
  title: string;
  url?: string;
  ean?: string;
}

const urlTokens = (url: string): string[] => {
  try {
    const parsed = new URL(url);
    return tokenize(`${parsed.hostname} ${parsed.pathname.replace(/[-_/]+/g, ' ')}`);
  } catch {
    return [];
  }
};

const volumesOf = (tokens: Iterable<string>): number[] =>
  [...tokens].map(volumeTokenToMl).filter((ml): ml is number => ml !== null);

/** A query for "350ml" against an offer that states "2l" is the wrong product, not a near miss. */
export const volumesDisagree = (queryTokens: string[], offerTokens: Set<string>): boolean => {
  const queryVolumes = volumesOf(queryTokens);
  if (queryVolumes.length === 0) return false;
  const offerVolumes = volumesOf(offerTokens);
  return offerVolumes.length > 0 && !offerVolumes.some((ml) => queryVolumes.includes(ml));
};

const coverageScore = (matched: number, queryCount: number, offerCount: number): number => {
  if (matched === 0) return 0;
  if (matched < queryCount) return Number((matched / queryCount).toFixed(4));
  const extras = offerCount - matched;
  const penalty = Math.min(0.05, (extras / Math.max(offerCount, 1)) * 0.05);
  return Number((1 - penalty).toFixed(4));
};

/**
 * No-AI relevance: what fraction of the query's tokens the offer's title (and
 * URL) contains, with two hard rules learned from the reference system:
 *
 * - An EAN match is identity — score 1 regardless of wording.
 * - A stated volume must AGREE (see volumesDisagree).
 *
 * Full token coverage scores ≥ 0.95 (extra words shave up to 0.05), partial
 * coverage scores matched/total — naturally below a 0.95 threshold.
 */
export const scoreRelevance = (query: RelevanceInput, offer: OfferText): number => {
  if (query.ean && offer.ean && query.ean === offer.ean) return 1;

  const queryTokens = [...new Set(tokenize(`${query.brand ?? ''} ${query.term}`))];
  if (queryTokens.length === 0) return 0;

  const offerTokens = new Set([...tokenize(offer.title), ...(offer.url ? urlTokens(offer.url) : [])]);
  if (volumesDisagree(queryTokens, offerTokens)) return 0;

  const matched = queryTokens.filter((token) => offerTokens.has(token)).length;
  return coverageScore(matched, queryTokens.length, offerTokens.size);
};
