import { z } from 'zod';
import { availabilityFromText } from '../normalize/availability';
import { isBrlPrice } from '../normalize/currency';
import { parseMoneyToCents } from '../normalize/money';
import { shippingCentsFromText } from '../normalize/shipping';
import type { MarketVocabulary } from '../normalize/vocabulary';
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
import { regionToLocation } from './serp-location';
import type { ConnectorContext, ConnectorResult, PriceSourceConnector } from './types';
import { diagnosticsOf } from './types';

/**
 * SERP connector (FUT-418): Google Shopping Brazil through SearchApi.io — the
 * wide-coverage net that surfaces offers from stores we have no connector
 * for, deep-linking to wherever Google Shopping found the product.
 *
 * Extraction is DETERMINISTIC ONLY (no AI anywhere on this path): the price
 * waterfall is `extracted_price` → `price` string parse → a detected price in
 * `extensions`; shipping is read from the `delivery` line and from nowhere
 * else; non-BRL results are dropped; results with neither a price nor an
 * availability signal are discarded. The request is pinned to Brazil with
 * `gl=br` + `hl=pt-BR` and localized further with a `location` derived from
 * the tenant's region — the CEP the pipeline passes, resolved by
 * ./serp-location (or `config.location` when the tenant set one explicitly).
 *
 * `google_domain` is deliberately NOT sent (FUT-518). SearchApi's own
 * google_shopping docs record the parameter as deprecated since 2025-04-15:
 * Google is phasing out country-code TLDs and now redirects google.com.br to
 * google.com, so the value bought nothing while the vendor's guidance is to
 * localize with gl/hl — which this request already does.
 *
 * ONE vendor call per (source, query, region): unlike VTEX there is no EAN
 * retry round-trip, because every retry is paid — cost per run must be
 * predictable for the budget gate that runs before this connector.
 *
 * Config (PriceSource.config), all optional:
 *   { "location": "Sao Paulo,State of Sao Paulo,Brazil" }
 */

const GOOGLE_SHOPPING_ENGINE = 'google_shopping';

const configSchema = z.object({
  location: z.string().min(1).optional(),
});

// Loose on purpose (VTEX doctrine): we validate only what we read, and
// unknown fields must SURVIVE parsing because `raw` is the verbatim replay
// record for offline parser fixes.
const shoppingResultSchema = z.looseObject({
  title: z.string().nullish(),
  link: z.string().nullish(),
  product_link: z.string().nullish(),
  seller: z.string().nullish(),
  source: z.string().nullish(),
  price: z.string().nullish(),
  extracted_price: z.number().nullish(),
  currency: z.string().nullish(),
  thumbnail: z.string().nullish(),
  delivery: z.string().nullish(),
  tag: z.string().nullish(),
  extensions: z.array(z.string()).nullish(),
});

const responseSchema = z.looseObject({
  shopping_results: z.array(shoppingResultSchema).nullish(),
});

type ShoppingResult = z.infer<typeof shoppingResultSchema>;

// The R$ amount inside a free-text extension ("R$ 3,79 em 12x") — the token
// is cut out BEFORE parsing so surrounding digits never leak into the number.
const EXTENSION_PRICE = /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/;

const positiveCents = (value: string | number): number | undefined => {
  const cents = parseMoneyToCents(value);
  return cents !== null && cents > 0 ? cents : undefined;
};

/** The last waterfall stop: a detected R$ amount in the extension texts. */
const extensionPriceCents = (extensions: readonly string[]): number | undefined => {
  for (const extension of extensions) {
    const token = EXTENSION_PRICE.exec(extension)?.[0];
    const cents = token === undefined ? undefined : positiveCents(token);
    if (cents !== undefined) return cents;
  }
  return undefined;
};

/** The ticket's waterfall: extracted_price → price string → extensions. */
const priceCentsOf = (result: ShoppingResult): number | undefined => {
  if (typeof result.extracted_price === 'number') {
    const cents = positiveCents(result.extracted_price);
    if (cents !== undefined) return cents;
  }
  if (result.price) {
    const cents = positiveCents(result.price);
    if (cents !== undefined) return cents;
  }
  return extensionPriceCents(result.extensions ?? []);
};

const availabilityOf = (
  result: ShoppingResult,
  vocabulary: MarketVocabulary,
): RawOffer['availability'] =>
  availabilityFromText([result.tag, result.delivery, ...(result.extensions ?? [])], vocabulary);

const toRawOffer = (
  result: ShoppingResult,
  priceCents: number | undefined,
  vocabulary: MarketVocabulary,
): RawOffer => ({
  // The MERCHANT is the supplier — never the source's own name: a SERP row is
  // an offer by "Magazine Luiza", not by "Busca web".
  supplierName: result.seller ?? result.source ?? 'Google Shopping',
  title: result.title ?? '',
  // A direct merchant link beats the Google product page when both exist.
  url: result.link ?? result.product_link ?? undefined,
  imageUrl: result.thumbnail ?? undefined,
  currency: 'BRL',
  priceCents,
  // `delivery` ONLY (FUT-518), never `extensions`: EXTENSION_PRICE above
  // documents that those carry installment prices ("R$ 3,79 em 12x"), so a
  // money parse there would report a financing term as freight — inventing a
  // shipping cost the merchant never quoted.
  shippingCents: shippingCentsFromText([result.delivery], vocabulary),
  availability: availabilityOf(result, vocabulary),
  raw: result,
});

export const parseSerpResponse = (payload: unknown, vocabulary: MarketVocabulary): RawOffer[] => {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) return [];
  return (parsed.data.shopping_results ?? []).flatMap((result) => {
    if (!isBrlPrice(result.currency, result.price)) return [];
    const priceCents = priceCentsOf(result);
    const offer = toRawOffer(result, priceCents, vocabulary);
    // Neither a price nor an availability signal: nothing rankable, discard.
    if (offer.priceCents === undefined && offer.availability === undefined) return [];
    return [offer];
  });
};

const buildParams = (
  query: ResearchQuery,
  config: z.infer<typeof configSchema>,
): Record<string, string | undefined> => ({
  q: searchTermOf(query),
  gl: 'br',
  hl: 'pt-BR',
  location: config.location ?? regionToLocation(query.region),
});

export interface SerpConnectorOptions {
  /** Host env fallback seam (env/Doppler) — read per search, never cached.
   * The tenant credential in `source.config` (FUT-434) always wins over it. */
  getApiKey: SearchApiKeySource;
  /**
   * The words this connector reads in a merchant's stock and delivery lines
   * — the MARKET's, required and with no default (FUT-760). Without it, a
   * host outside Brazil would get a connector that parses cleanly and reports
   * unknown availability and unknown shipping on every single offer.
   */
  vocabulary: MarketVocabulary;
}

export const createSerpConnector = (options: SerpConnectorOptions): PriceSourceConnector => ({
  type: 'SERP',
  budgetScope: SEARCHAPI_BUDGET_SCOPE,
  async search(
    query: ResearchQuery,
    source: SourceRecord,
    ctx: ConnectorContext,
  ): Promise<ConnectorResult> {
    const config = configSchema.safeParse(source.config);
    if (!config.success) {
      // 'Busca web' is the tenant-facing name of this integration everywhere
      // else (the admin card, the seeded source), so the reason names what the
      // operator sees rather than the internal `SERP` type.
      return { ok: false, error: invalidConfigMessage('Busca web', config.error, diagnosticsOf(ctx).sourceConfig) };
    }
    const result = await callSearchApi(ctx, {
      engine: GOOGLE_SHOPPING_ENGINE,
      params: buildParams(query, config.data),
      apiKey: resolveSearchApiKey(source, options.getApiKey),
    });
    if (!result.ok) return result;
    return { ok: true, offers: parseSerpResponse(result.payload, options.vocabulary) };
  },
  validateCredentials: validateSearchApiKey,
});
