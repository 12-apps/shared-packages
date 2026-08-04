import { parsePack } from '../normalize/pack';
import { scoreRelevance } from '../scoring/relevance';
import type { RawOffer, ResearchQuery, ScoredOffer, SourceRecord } from '../types';
import type { SourceOutcome } from './query-source';

/**
 * Raw connector offer → the normalized, scored, rankable shape the store
 * persists. Split out of `run-research.ts` (FUT-519) alongside
 * `query-source.ts`: scoring now runs PER SOURCE, the moment that source
 * settles, instead of once over every outcome after the fan-out barrier.
 */

const toScoredOffer = (
  raw: RawOffer,
  source: SourceRecord,
  query: ResearchQuery,
  expiresAt: Date,
): ScoredOffer | null => {
  if (raw.priceCents === undefined || raw.priceCents <= 0) return null;

  const relevanceScore = scoreRelevance(
    { term: query.term, brand: query.brand, ean: query.ean },
    { title: raw.title, url: raw.url, ean: raw.ean },
  );

  const packQuantity = Math.max(raw.packQuantity ?? parsePack(raw.title).units, 1);
  const unitPriceCents = Math.round(raw.priceCents / packQuantity);
  // A source-declared horizon (manual list validity) can only SHORTEN the
  // TTL-based default — never extend an offer past what its source promised.
  // Re-wrapped in a Date because a cache round-trip serializes it to a string.
  const declaredExpiry = raw.expiresAt === undefined ? undefined : new Date(raw.expiresAt);
  const offerExpiresAt =
    declaredExpiry !== undefined && !Number.isNaN(declaredExpiry.getTime()) && declaredExpiry < expiresAt
      ? declaredExpiry
      : expiresAt;
  // Whole packs only: a buyer cannot purchase 5/12 of a fardo, so the total is
  // the realizable cost — enough packs to cover the quantity, plus shipping.
  //
  // FUT-518: `raw.shippingCents` is a TRI-STATE and is carried through UNTOUCHED
  // (see `RawOffer.shippingCents`). This line still adds 0 for an unknown, but
  // that 0 is now a FLOOR and never a claim: `totalCents` is a LOWER BOUND on
  // what the buyer pays whenever `shippingCents` is undefined. The alternative —
  // estimating freight — would invent a number the source never gave, so the
  // unknown is priced at its minimum and CARRIED as an unknown so every surface
  // downstream can say so. Before this, the coalesce happened on the way INTO
  // the offer, which erased the distinction and made a Google Shopping offer
  // (serp.ts never states shipping) compete as if it shipped free.
  const quantity = Math.max(query.quantity, 1);
  const packsNeeded = Math.ceil(quantity / packQuantity);
  const totalCents = packsNeeded * raw.priceCents + (raw.shippingCents ?? 0);

  return {
    sourceId: source.id,
    sourceType: source.type,
    supplierName: raw.supplierName,
    title: raw.title,
    url: raw.url,
    imageUrl: raw.imageUrl,
    currency: raw.currency ?? 'BRL',
    priceCents: raw.priceCents,
    shippingCents: raw.shippingCents,
    packQuantity,
    unitPriceCents,
    totalCents,
    availability: raw.availability,
    etaDays: raw.etaDays,
    relevanceScore,
    raw: raw.raw,
    expiresAt: offerExpiresAt,
    // Carried through untouched (FUT-491): the connector is the only thing
    // that knows whether the store delivers to the buyer's region.
    outsideDeliveryArea: raw.outsideDeliveryArea,
  };
};

/**
 * One source's raw offers, normalized and filtered to what the buyer may see:
 * priceless offers dropped, everything below `minRelevance` dropped. NO rank —
 * ranking is global to the run and only the terminal chain can assign it.
 */
export const scoreSourceOffers = (
  outcome: SourceOutcome,
  query: ResearchQuery,
  expiresAt: Date,
  minRelevance: number,
): ScoredOffer[] =>
  outcome.offers
    .map((raw) => toScoredOffer(raw, outcome.source, query, expiresAt))
    .filter((offer): offer is ScoredOffer => offer !== null)
    .filter((offer) => offer.relevanceScore >= minRelevance);
