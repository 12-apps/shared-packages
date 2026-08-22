import { z } from 'zod';
import type { ResearchQuery, SourceRecord } from '../types';
import { fetchJsonOutcome } from './fetch-reason';
import type { ConnectorContext, ConnectorResult, FetchInit, PriceSourceConnector } from './types';
import { vtexAuthInit } from './vtex-auth';
import { type DeliverySku, deliverableSkus } from './vtex-delivery';
import {
  type OfferWithSku,
  type VtexProducts,
  parseVtexPairs,
  parseVtexProducts,
  parseVtexResponse,
  productsToPairs,
} from './vtex-parse';
import { vtexFailureMessage } from './vtex-errors';
import { resolveVtexRegion } from './vtex-regions';
import { validateVtexSourceConfig } from './vtex-validate';

/**
 * Generic VTEX storefront connector. Every VTEX shop exposes the same public
 * catalog search API, so one more store is one more `PriceSource` config row —
 * no new code. Verified live against Giga Atacado (giga.com.vc) and Atacadão
 * (atacadao.com.br).
 *
 * Config (PriceSource.config):
 *   {
 *     "baseUrl": "https://www.giga.com.vc",
 *     "salesChannel": "1"?,
 *     "regionSalesChannels": { "01": "2", "20310": "3" }?,
 *     "regionalize": true?
 *   }
 *
 * A source may ALSO carry an optional VTEX application key (FUT-520), injected
 * by the host under `config.credentials` and read by `./vtex-auth` — not by
 * `configSchema`, which is the operator's own fields. It changes the HEADERS
 * and nothing else: same tiers, same endpoints, byte-identical URLs. It is
 * deliberately not a route to the `pvt` API — the parser reads the public
 * `items[].sellers[].commertialOffer` chain, and regional pricing (FUT-416) and
 * the delivery simulation (FUT-514) only exist on these public endpoints.
 *
 * Regionalization, two tiers (FUT-416):
 * 1. AUTOMATIC — a query with a full CEP resolves it through the store's own
 *    public regions API (`/api/checkout/pub/regions`), which answers with the
 *    region id and the sellers serving that address. A region the store does
 *    not serve (sellers: []) still answers — with its DEFAULT region's catalog,
 *    every offer FLAGGED `outsideDeliveryArea` (FUT-491, owner's call from
 *    production: "there is no sense in not return information"). The flag is
 *    what makes that honest; silence was the previous behaviour and it left the
 *    buyer with nothing. A served region's id goes onto the intelligent-search
 *    request (`regionId`), which is where VTEX IO stores price regionally (verified
 *    live: the same Atacadão SKU answers R$ 3,79 in São Paulo and R$ 3,99 in
 *    Rio). Stores without IO search fall back to the legacy catalog search
 *    below. `"regionalize": false` opts a source out of the probe.
 * 2. EXPLICIT — `regionSalesChannels` maps CEP prefixes (digits only, longest
 *    prefix wins) to the sales channel that prices that region, for stores
 *    whose regionalization is channel-based per-store knowledge. An explicit
 *    match wins over the automatic tier; anything else falls back to the
 *    default `salesChannel`. The cache key already carries the region, so two
 *    regions never share an answer.
 *
 * Failures say WHY (FUT-495). Each of the three tiers reports through
 * `./vtex-errors`, so the stored error names the tier, the reason (HTTP status,
 * timeout, transport) and the endpoint — never a query string. Only the legacy
 * catalog tier is fatal; the regions probe (`./vtex-regions`) and
 * intelligent-search fall back by design and log their reason instead.
 */

const salesChannelSchema = z.union([z.string(), z.number()]);

const configSchema = z.object({
  baseUrl: z.string().url(),
  salesChannel: salesChannelSchema.optional(),
  regionSalesChannels: z.record(z.string(), salesChannelSchema).optional(),
  regionalize: z.boolean().optional(),
});

type VtexConfig = z.infer<typeof configSchema>;

/**
 * One search's request identity: the parsed config, and the per-call init every
 * tier shares. Resolved ONCE in `search` and threaded whole, so no tier can be
 * left running under a different (or no) application key than the others.
 */
type VtexRequest = { config: VtexConfig; init?: FetchInit };

/**
 * The explicitly configured channel for a region: the longest
 * `regionSalesChannels` CEP-prefix match (both sides digit-normalized), or
 * undefined when the config has no opinion about this region.
 */
const regionChannelMatch = (config: VtexConfig, region?: string): string | undefined => {
  const cep = (region ?? '').replace(/\D/g, '');
  const mapping = config.regionSalesChannels;
  if (!cep || !mapping) return undefined;
  const match = Object.keys(mapping)
    .map((prefix) => prefix.replace(/\D/g, ''))
    .filter((prefix) => prefix.length > 0 && cep.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  if (match === undefined) return undefined;
  const entry = Object.entries(mapping).find(([key]) => key.replace(/\D/g, '') === match);
  return entry ? String(entry[1]) : undefined;
};

/**
 * The sales channel one query should use: the explicit region mapping, or the
 * store's default channel. Undefined = the store's own default pricing.
 */
export const salesChannelFor = (config: VtexConfig, region?: string): string | undefined =>
  regionChannelMatch(config, region) ??
  (config.salesChannel === undefined ? undefined : String(config.salesChannel));

/**
 * What a search tier found, before deliverability is asked about. Every tier
 * carries the sku pairing so the delivery verdict can be applied ONCE, at the
 * end, on whichever tier answered — rather than each tier making its own claim.
 */
type PairResult = { ok: true; pairs: OfferWithSku[] } | { ok: false; error: string };

/** The full-text term: the buyer's words, brand-prefixed when absent from them. */
const searchTerm = (query: ResearchQuery): string => {
  const brandMissing =
    query.brand !== undefined && !query.term.toLowerCase().includes(query.brand.toLowerCase());
  return (brandMissing ? `${query.brand} ${query.term}` : query.term).trim();
};

const buildSearchUrl = (baseUrl: string, query: ResearchQuery, salesChannel?: string): string => {
  const root = baseUrl.replace(/\/+$/, '');
  const sc = salesChannel ? `&sc=${encodeURIComponent(salesChannel)}` : '';
  if (query.ean) {
    return `${root}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(query.ean)}${sc}`;
  }
  return `${root}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(searchTerm(query))}${sc}`;
};

/**
 * Region-priced search on the intelligent-search API. An EAN is a `query`
 * term too — IO search indexes GTINs in the same full-text field. The path is
 * deliberately SLASHLESS before the query string: Atacadão's edge 308s the
 * trailing-slash form to it, while Giga answers both — the slashless spelling
 * is the canonical one everywhere (verified live, FUT-416).
 */
const buildRegionSearchUrl = (baseUrl: string, query: ResearchQuery, regionId: string): string => {
  const root = baseUrl.replace(/\/+$/, '');
  const text = query.ean ?? searchTerm(query);
  return (
    `${root}/api/io/_v/api/intelligent-search/product_search` +
    `?query=${encodeURIComponent(text)}&regionId=${encodeURIComponent(regionId)}`
  );
};


/**
 * One intelligent-search request, parsed into products — or `null`, meaning
 * "this store has no usable IO search" and the caller must fall back. The
 * reason is LOGGED with the tier's name (FUT-495) so a store that does have IO
 * search but 403s it stops looking like a store that has none.
 */
const regionProducts = async (
  ctx: ConnectorContext,
  url: string,
  init?: FetchInit,
): Promise<VtexProducts | null> => {
  const outcome = await fetchJsonOutcome(ctx, url, init);
  if (!outcome.ok) {
    ctx.logger.info(
      vtexFailureMessage('intelligent-search', outcome.failure, url, ctx.diagnostics, init !== undefined),
    );
    return null;
  }
  return parseVtexProducts(outcome.payload);
};

/**
 * The automatic-tier search: intelligent-search with the resolved region id,
 * mirroring the legacy path's EAN → text fallback. `null` means the store does
 * not expose IO search (or answered nonsense) — the caller falls back to the
 * legacy catalog search rather than treating it as an outage.
 */
const regionSearch = async (
  query: ResearchQuery,
  source: SourceRecord,
  ctx: ConnectorContext,
  request: VtexRequest,
  regionId: string,
): Promise<PairResult | null> => {
  const { baseUrl } = request.config;
  const url = buildRegionSearchUrl(baseUrl, query, regionId);
  const products = await regionProducts(ctx, url, request.init);
  if (products === null) return null;
  const pairs = productsToPairs(products, source, baseUrl);
  if (pairs.length === 0 && query.ean) {
    const textUrl = buildRegionSearchUrl(baseUrl, { ...query, ean: undefined }, regionId);
    const fallback = await regionProducts(ctx, textUrl, request.init);
    if (fallback === null) return null;
    return { ok: true, pairs: productsToPairs(fallback, source, baseUrl) };
  }
  return { ok: true, pairs };
};

/**
 * One catalog-search request: the parsed payload, or the ERROR the run records
 * — the actionable sentence (FUT-495), not a blanket "unreachable". This is the
 * fatal tier: a store that cannot answer here has nothing else to fall back to.
 */
const catalogPayload = async (
  ctx: ConnectorContext,
  url: string,
  init?: FetchInit,
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string }> => {
  const outcome = await fetchJsonOutcome(ctx, url, init);
  return outcome.ok
    ? { ok: true, payload: outcome.payload }
    : { ok: false, error: vtexFailureMessage('catalog', outcome.failure, url, ctx.diagnostics, init !== undefined) };
};

/**
 * The legacy default-channel catalog search: the explicit tier's channel
 * mapping or the store's own default pricing. This is the same path the no-CEP
 * case takes.
 */
const legacyCatalogSearch = async (
  query: ResearchQuery,
  source: SourceRecord,
  ctx: ConnectorContext,
  request: VtexRequest,
): Promise<PairResult> => {
  const { baseUrl } = request.config;
  const salesChannel = salesChannelFor(request.config, query.region);

  const url = buildSearchUrl(baseUrl, query, salesChannel);
  const answer = await catalogPayload(ctx, url, request.init);
  if (!answer.ok) return answer;

  const pairs = parseVtexPairs(answer.payload, source, baseUrl);
  // An EAN lookup that finds nothing falls back to a text search once —
  // stores don't always index alternate ids. A fallback outage is still an
  // outage: it must surface as a degraded source, never as an empty success.
  if (pairs.length === 0 && query.ean) {
    const textUrl = buildSearchUrl(baseUrl, { ...query, ean: undefined }, salesChannel);
    const fallback = await catalogPayload(ctx, textUrl, request.init);
    if (!fallback.ok) return fallback;
    return { ok: true, pairs: parseVtexPairs(fallback.payload, source, baseUrl) };
  }
  return { ok: true, pairs };
};

/**
 * Automatic tier: with a full CEP and no explicit channel mapping for it, ask
 * the store which region serves the buyer, so intelligent-search can price
 * regionally. `null` ⇒ nothing regional applies (no CEP, opted out, no regional
 * knowledge, or no IO search) and the caller runs the legacy catalog path.
 *
 * It no longer decides DELIVERABILITY. That verdict moved to the simulation
 * (FUT-514) — see `applyDeliveryFlags` — because the regions endpoint cannot
 * tell a store that does not serve a CEP from one that merely does not
 * regionalize by seller, and reading it as the former flagged every offer of
 * every store of the latter kind.
 */
const autoRegionTier = async (
  query: ResearchQuery,
  source: SourceRecord,
  ctx: ConnectorContext,
  request: VtexRequest,
): Promise<PairResult | null> => {
  const { config } = request;
  if (!query.region || config.regionalize === false) return null;
  if (regionChannelMatch(config, query.region) !== undefined) return null;
  const region = await resolveVtexRegion(ctx, config.baseUrl, query.region, request.init);
  if (region.kind === 'unknown') return null;
  const regional = await regionSearch(query, source, ctx, request, region.regionId);
  if (regional === null) {
    ctx.logger.info(
      `VTEX source "${source.name}" has no intelligent-search; using the default-region catalog search.`,
    );
  }
  return regional;
};

/**
 * Ask the store what it will actually deliver to this CEP, and flag what it
 * will not (FUT-491's caveat, FUT-514's verdict). An offer the store cannot
 * deliver is still returned and still ranked — information beats silence, and
 * an out-of-area price is a negotiating number — but no surface may present it
 * as deliverable here.
 *
 * Three things deliberately claim NOTHING rather than guess: a query with no
 * CEP, offers whose store publishes no sku/seller ids, and a simulation that
 * could not answer (`null`). The defect this replaces was precisely a probe
 * that could not tell, reporting a verdict anyway.
 */
const applyDeliveryFlags = async (
  query: ResearchQuery,
  ctx: ConnectorContext,
  request: VtexRequest,
  pairs: OfferWithSku[],
): Promise<ConnectorResult> => {
  const { config } = request;
  const offers = pairs.map((pair) => pair.offer);
  if (!query.region) return { ok: true, offers };

  const skus = pairs
    .map((pair) => pair.sku)
    .filter((sku): sku is DeliverySku => sku !== null);
  const deliverable = await deliverableSkus(
    ctx,
    config.baseUrl,
    salesChannelFor(config, query.region),
    query.region,
    skus,
    request.init,
  );
  if (deliverable === null) return { ok: true, offers };

  // NOTHING deliverable is not a verdict — it is the shape a MISCONFIGURED
  // channel also has. On the wrong sales channel the simulation answers "não
  // tem estoque" for every CEP, including ones the store demonstrably serves,
  // which is indistinguishable here from a store that genuinely reaches none of
  // this. Claiming out-of-area on that would rebuild the FUT-514 defect behind
  // a new endpoint, so an undiscriminating answer claims nothing and says so.
  if (deliverable.size === 0) {
    ctx.logger.info(
      `VTEX source delivery simulation returned no deliverable SKU for region ${query.region}; ` +
        'making no out-of-area claim — check the source\'s salesChannel before reading this as "not served".',
    );
    return { ok: true, offers };
  }

  return {
    ok: true,
    offers: pairs.map((pair) =>
      pair.sku && !deliverable.has(pair.sku.skuId)
        ? { ...pair.offer, outsideDeliveryArea: true }
        : pair.offer,
    ),
  };
};

export { parseVtexResponse };

export const vtexConnector: PriceSourceConnector = {
  type: 'VTEX',
  // Save-time live probe of `{ baseUrl }` (FUT-492) — see `./vtex-validate`.
  validateSourceConfig: validateVtexSourceConfig,
  async search(query: ResearchQuery, source: SourceRecord, ctx: ConnectorContext): Promise<ConnectorResult> {
    const config = configSchema.safeParse(source.config);
    if (!config.success) {
      return { ok: false, error: `invalid VTEX config for source "${source.name}": ${config.error.message}` };
    }

    // Resolved once, shared by every tier — including the regions probe and the
    // delivery simulation, so a keyed source is keyed everywhere or nowhere.
    const request: VtexRequest = { config: config.data, init: vtexAuthInit(source) };

    const found =
      (await autoRegionTier(query, source, ctx, request)) ??
      (await legacyCatalogSearch(query, source, ctx, request));
    if (!found.ok) return found;

    return applyDeliveryFlags(query, ctx, request, found.pairs);
  },
};
