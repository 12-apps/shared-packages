import { z } from 'zod';
import { availabilityFromText } from '../normalize/availability';
import { isBrlPrice } from '../normalize/currency';
import { parseMoneyToCents } from '../normalize/money';
import { shippingCentsFromText } from '../normalize/shipping';
import type { MarketVocabulary } from '../normalize/vocabulary';
import { normalizeText } from '../normalize/text';
import type { RawOffer, ResearchQuery, SourceRecord } from '../types';
import { invalidConfigMessage } from './config-errors';
import {
  callSearchApi,
  resolveSearchApiKey,
  SEARCHAPI_BUDGET_SCOPE,
  searchTermOf,
  validateSearchApiKey,
} from './searchapi';
import type { SearchApiKeySource } from './searchapi';
import type { ConnectorContext, ConnectorResult, PriceSourceConnector } from './types';
import { diagnosticsOf } from './types';

/**
 * Amazon Brazil connector (FUT-419): amazon.com.br as a dedicated source —
 * beverage multipacks and snacks at competitive prices with fast delivery —
 * instead of relying on it surfacing through Google Shopping.
 *
 * ROUTE DECISION: SearchApi.io's `amazon_search` engine with
 * `amazon_domain=amazon.com.br`, riding the SAME vendor account (and the same
 * transport, key seam and budget scope — see searchapi.ts) as the SERP
 * connector. No scraping, no separate approval process. The documented
 * ALTERNATIVE is Amazon PA-API 5.0 (SearchItems): official and richer (EAN,
 * per-offer listings), but gated on Associados program approval and ongoing
 * qualifying affiliate sales — an operational dependency this phase doesn't
 * want. The connector port makes the swap cheap later: a PA-API connector is
 * this file's `toRawOffer` mapping over a different client, nothing else.
 *
 * Extraction is DETERMINISTIC ONLY, the SERP doctrine: price waterfall is
 * `extracted_price` → `price` string parse; non-BRL results are dropped;
 * results with neither a price nor an availability signal are discarded.
 * The ASIN is the listing's identity — it rides `raw` verbatim and shapes the
 * canonical `/dp/<ASIN>` URL, which the pipeline's dedupe uses to collapse
 * the same listing arriving via SERP. Prime/shipping hints: the Prime badge
 * implies zero shipping, and beyond it the delivery line goes through the
 * `normalize/shipping.ts` helper this connector SHARES with SERP (FUT-518),
 * so the two can no longer disagree about the same vendor string. A
 * same-day/next-day delivery promise maps to etaDays 0/1 — anything less
 * literal stays unparsed in `raw`.
 *
 * No region parameter: Amazon localizes by marketplace domain, not by a
 * request location — the CEP only affects checkout, which is the buyer's.
 *
 * Config (PriceSource.config), all optional:
 *   { "amazonDomain": "amazon.com.br" }
 */

const AMAZON_SEARCH_ENGINE = 'amazon_search';

export const AMAZON_BRAZIL_DOMAIN = 'amazon.com.br';

const configSchema = z.object({
  amazonDomain: z.string().min(1).optional(),
});

// Loose on purpose (VTEX doctrine): we validate only what we read, and
// unknown fields must SURVIVE parsing because `raw` is the verbatim replay
// record for offline parser fixes.
const organicResultSchema = z.looseObject({
  asin: z.string().nullish(),
  title: z.string().nullish(),
  link: z.string().nullish(),
  thumbnail: z.string().nullish(),
  seller: z.string().nullish(),
  price: z.string().nullish(),
  extracted_price: z.number().nullish(),
  currency: z.string().nullish(),
  is_prime: z.boolean().nullish(),
  availability: z.string().nullish(),
  delivery: z.union([z.string(), z.array(z.string())]).nullish(),
  shipping_info: z.string().nullish(),
});

const responseSchema = z.looseObject({
  organic_results: z.array(organicResultSchema).nullish(),
});

type OrganicResult = z.infer<typeof organicResultSchema>;

const positiveCents = (value: string | number): number | undefined => {
  const cents = parseMoneyToCents(value);
  return cents !== null && cents > 0 ? cents : undefined;
};

/** The SERP waterfall, minus extensions (amazon results don't carry them). */
const priceCentsOf = (result: OrganicResult): number | undefined => {
  if (typeof result.extracted_price === 'number') {
    const cents = positiveCents(result.extracted_price);
    if (cents !== undefined) return cents;
  }
  return result.price ? positiveCents(result.price) : undefined;
};

const deliveryTextsOf = (result: OrganicResult): string[] => {
  const delivery = result.delivery ?? [];
  const texts = typeof delivery === 'string' ? [delivery] : delivery;
  return [...texts, ...(result.shipping_info ? [result.shipping_info] : [])];
};

/**
 * "Receba hoje/amanhã" is a literal promise; anything vaguer stays unknown.
 *
 * WHICH day counts as 0 and which as 1 is this module's answer; the words a
 * merchant names them with are the market's (FUT-760).
 */
const etaDaysOf = (deliveryText: string, vocabulary: MarketVocabulary): number | undefined => {
  const text = normalizeText(deliveryText);
  if (vocabulary.sameDay.test(text)) return 0;
  if (vocabulary.nextDay.test(text)) return 1;
  return undefined;
};

const toRawOffer = (
  result: OrganicResult,
  domain: string,
  vocabulary: MarketVocabulary,
): RawOffer => {
  const deliveryTexts = deliveryTextsOf(result);
  const deliveryText = deliveryTexts.join(' ');
  const asin = result.asin?.trim() || undefined;
  return {
    // The marketplace is where the buyer pays; a marketplace seller, when the
    // vendor names one, is the actual merchant (SERP doctrine).
    supplierName: result.seller ?? domain.charAt(0).toUpperCase() + domain.slice(1),
    title: result.title ?? '',
    // The vendor's deep link when present; the ASIN alone still buys — the
    // canonical /dp/ URL is a stable buy link AND the dedupe identity.
    url: result.link ?? (asin ? `https://www.${domain}/dp/${asin}` : undefined),
    imageUrl: result.thumbnail ?? undefined,
    currency: 'BRL',
    priceCents: priceCentsOf(result),
    // The Prime badge is a shipping statement in its own right, so it stays an
    // explicit override ahead of the text; everything else is the shared
    // parser, on the delivery texts only.
    shippingCents:
      result.is_prime === true ? 0 : shippingCentsFromText(deliveryTexts, vocabulary),
    availability: availabilityFromText([result.availability, ...deliveryTexts], vocabulary),
    etaDays: etaDaysOf(deliveryText, vocabulary),
    raw: result,
  };
};

export const parseAmazonResponse = (
  payload: unknown,
  vocabulary: MarketVocabulary,
  domain: string = AMAZON_BRAZIL_DOMAIN,
): RawOffer[] => {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) return [];
  return (parsed.data.organic_results ?? []).flatMap((result) => {
    if (!isBrlPrice(result.currency, result.price)) return [];
    const offer = toRawOffer(result, domain, vocabulary);
    // Neither a price nor an availability signal: nothing rankable, discard.
    if (offer.priceCents === undefined && offer.availability === undefined) return [];
    return [offer];
  });
};

export interface AmazonConnectorOptions {
  /** Host env fallback seam (env/Doppler) — read per search, never cached.
   * The tenant credential in `source.config` (FUT-434) always wins over it. */
  getApiKey: SearchApiKeySource;
  /**
   * The words this connector reads in a merchant's stock and delivery lines
   * — the MARKET's, required and with no default (FUT-760). Without it, a
   * host outside Brazil would get a connector that parses cleanly and reports
   * unknown availability, unknown shipping and unknown ETA on every offer.
   */
  vocabulary: MarketVocabulary;
}

export const createAmazonConnector = (options: AmazonConnectorOptions): PriceSourceConnector => ({
  type: 'AMAZON',
  budgetScope: SEARCHAPI_BUDGET_SCOPE,
  async search(
    query: ResearchQuery,
    source: SourceRecord,
    ctx: ConnectorContext,
  ): Promise<ConnectorResult> {
    const config = configSchema.safeParse(source.config);
    if (!config.success) {
      return { ok: false, error: invalidConfigMessage('Amazon', config.error, diagnosticsOf(ctx).sourceConfig) };
    }
    const domain = config.data.amazonDomain ?? AMAZON_BRAZIL_DOMAIN;
    const result = await callSearchApi(ctx, {
      engine: AMAZON_SEARCH_ENGINE,
      params: { q: searchTermOf(query), amazon_domain: domain },
      apiKey: resolveSearchApiKey(source, options.getApiKey),
    });
    if (!result.ok) return result;
    return { ok: true, offers: parseAmazonResponse(result.payload, options.vocabulary, domain) };
  },
  validateCredentials: validateSearchApiKey,
});
