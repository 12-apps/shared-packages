import { z } from 'zod';
import { parseMoneyToCents } from '../normalize/money';
import type { RawOffer, ResearchQuery, SourceRecord } from '../types';
import type { MercadoLivreAuth } from './mercado-livre-auth';
import {
  catalogProductSchema,
  catalogSearchSchema,
  searchResponseSchema,
  shippingOptionsSchema,
  userSchema,
} from './mercado-livre-schemas';
import type { CatalogProduct, SearchItem, ShippingInfo } from './mercado-livre-schemas';
import type { ConnectorContext, ConnectorResult, PriceSourceConnector } from './types';

/**
 * Mercado Livre connector (FUT-417) — the one channel with an official,
 * documented developer API where distributors sell beverage bulk with real
 * prices. Search endpoints require an OAuth2 access token, so the connector is
 * created with a `MercadoLivreAuth` (see mercado-livre-auth.ts) that acquires
 * and refreshes tokens centrally with host-supplied credentials; a persistent
 * auth failure degrades the source, it never fails the run.
 *
 * Lookup order: when the query carries an EAN, the catalog-products lookup
 * (`/products/search?product_identifier=`) goes first — GTIN matching is far
 * more precise than text search — and falls back to `/sites/{site}/search`
 * once when it finds nothing, mirroring the VTEX doctrine (a fallback outage
 * is still an outage, never an empty success).
 *
 * Config (PriceSource.config), all optional:
 *   { "siteId": "MLB", "minReputationLevel": 4 }
 */

const DEFAULT_ML_API_BASE_URL = 'https://api.mercadolibre.com';

/** Reputation `level_id` is "1_red" … "5_green"; 4 keeps light-green and up. */
const DEFAULT_MIN_REPUTATION_LEVEL = 4;
/** Bounded fan-out, in deference to ML rate limits (results are cached 24h). */
const SEARCH_LIMIT = 50;
const CATALOG_PRODUCT_LIMIT = 3;
const SHIPPING_LOOKUP_LIMIT = 5;

const configSchema = z.object({
  siteId: z.string().trim().regex(/^[A-Z]{3}$/).default('MLB'),
  minReputationLevel: z.number().int().min(1).max(5).default(DEFAULT_MIN_REPUTATION_LEVEL),
});

/** A raw offer plus the MLB item id, kept only for the shipping-by-CEP lookup. */
interface MappedOffer {
  itemId: string | null;
  offer: RawOffer;
}

type MappedResult = { ok: true; mapped: MappedOffer[] } | { ok: false; error: string };

/** Authenticated GET seam handed around the lookup steps. */
interface MlClient {
  base: string;
  get(url: string): Promise<unknown | null>;
}

const centsOf = (price: number | null | undefined): number | null =>
  price == null ? null : parseMoneyToCents(price);

/** A listing without a positive price, or with a KNOWN zero stock, is not buyable. */
const isPurchasable = (
  priceCents: number | null,
  availableQuantity: number | null | undefined,
): priceCents is number =>
  priceCents !== null && priceCents > 0 && (availableQuantity == null || availableQuantity > 0);

const freeShippingCents = (shipping: ShippingInfo | null | undefined): number | undefined =>
  shipping?.free_shipping === true ? 0 : undefined;

const reputationLevel = (item: SearchItem): number | null => {
  const raw = item.seller?.seller_reputation?.level_id;
  if (!raw) return null;
  const level = Number.parseInt(raw, 10);
  return Number.isInteger(level) ? level : null;
};

const gtinOf = (attributes: SearchItem['attributes']): string | undefined => {
  const match = (attributes ?? []).find(
    (attribute) => attribute.id === 'GTIN' || attribute.id === 'EAN',
  );
  return match?.value_name ?? undefined;
};

const searchItemToMapped = (item: SearchItem, source: SourceRecord): MappedOffer | null => {
  const priceCents = centsOf(item.price);
  if (!isPurchasable(priceCents, item.available_quantity)) return null;
  return {
    itemId: item.id ?? null,
    offer: {
      supplierName: item.seller?.nickname ?? source.name,
      title: item.title ?? '',
      url: item.permalink ?? undefined,
      imageUrl: item.thumbnail ?? undefined,
      ean: gtinOf(item.attributes),
      currency: item.currency_id ?? 'BRL',
      priceCents,
      shippingCents: freeShippingCents(item.shipping),
      availability: 'IN_STOCK',
      raw: item,
    },
  };
};

const mapSearchResults = (
  payload: unknown,
  source: SourceRecord,
  minReputationLevel: number,
): MappedOffer[] => {
  const parsed = searchResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  return (parsed.data.results ?? []).flatMap((item) => {
    // `condition=new` is already in the request; this drops the stragglers.
    if (item.condition != null && item.condition !== 'new') return [];
    // A seller with a KNOWN level below the floor is out; an unknown level
    // (new sellers, catalog payloads) is kept — the buyer sees the link.
    const level = reputationLevel(item);
    if (level !== null && level < minReputationLevel) return [];
    const mapped = searchItemToMapped(item, source);
    return mapped === null ? [] : [mapped];
  });
};

/** Search-results parser, exported for fixture tests and offline replay. */
export const parseMercadoLivreSearch = (
  payload: unknown,
  source: SourceRecord,
  minReputationLevel: number = DEFAULT_MIN_REPUTATION_LEVEL,
): RawOffer[] => mapSearchResults(payload, source, minReputationLevel).map((entry) => entry.offer);

const buildTextSearchUrl = (base: string, query: ResearchQuery, siteId: string): string => {
  const brandMissing =
    query.brand !== undefined && !query.term.toLowerCase().includes(query.brand.toLowerCase());
  const term = (brandMissing ? `${query.brand} ${query.term}` : query.term).trim();
  return `${base}/sites/${encodeURIComponent(siteId)}/search?q=${encodeURIComponent(term)}&condition=new&limit=${SEARCH_LIMIT}`;
};

const searchByText = async (
  client: MlClient,
  query: ResearchQuery,
  siteId: string,
  minReputationLevel: number,
  source: SourceRecord,
): Promise<MappedResult> => {
  const url = buildTextSearchUrl(client.base, query, siteId);
  const payload = await client.get(url);
  if (payload === null) return { ok: false, error: `Mercado Livre search unreachable: ${url}` };
  return { ok: true, mapped: mapSearchResults(payload, source, minReputationLevel) };
};

/** Nicknames of the buy-box sellers, best-effort — a miss falls back to the source name. */
const sellerNicknames = async (
  client: MlClient,
  products: CatalogProduct[],
): Promise<Map<number, string>> => {
  const ids = [
    ...new Set(
      products
        .map((product) => product.buy_box_winner?.seller_id)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];
  const users = await Promise.all(ids.map((id) => client.get(`${client.base}/users/${id}`)));
  const nicknames = new Map<number, string>();
  ids.forEach((id, index) => {
    const parsed = userSchema.safeParse(users[index]);
    if (parsed.success && parsed.data.nickname) nicknames.set(id, parsed.data.nickname);
  });
  return nicknames;
};

const supplierOf = (
  sellerId: number | null | undefined,
  nicknames: Map<number, string>,
  fallback: string,
): string => (typeof sellerId === 'number' ? nicknames.get(sellerId) : undefined) ?? fallback;

const catalogProductToMapped = (
  product: CatalogProduct,
  source: SourceRecord,
  ean: string,
  nicknames: Map<number, string>,
): MappedOffer | null => {
  const winner = product.buy_box_winner;
  // No buy-box winner = no purchasable offer on the catalog page right now.
  if (winner == null) return null;
  const priceCents = centsOf(winner.price);
  if (!isPurchasable(priceCents, winner.available_quantity)) return null;
  return {
    itemId: winner.item_id ?? null,
    offer: {
      supplierName: supplierOf(winner.seller_id, nicknames, source.name),
      title: product.name ?? '',
      url: product.permalink ?? undefined,
      imageUrl: product.pictures?.[0]?.url ?? undefined,
      // The catalog matched by identifier, so the query's EAN is this offer's
      // identity — which is exactly what the relevance scorer rewards.
      ean,
      currency: winner.currency_id ?? 'BRL',
      priceCents,
      shippingCents: freeShippingCents(winner.shipping),
      availability: 'IN_STOCK',
      raw: product,
    },
  };
};

const searchCatalogByEan = async (
  client: MlClient,
  ean: string,
  siteId: string,
  source: SourceRecord,
): Promise<MappedResult> => {
  const url = `${client.base}/products/search?status=active&site_id=${encodeURIComponent(siteId)}&product_identifier=${encodeURIComponent(ean)}`;
  const payload = await client.get(url);
  if (payload === null) {
    return { ok: false, error: `Mercado Livre catalog lookup unreachable: ${url}` };
  }
  const parsed = catalogSearchSchema.safeParse(payload);
  const ids = (parsed.success ? (parsed.data.results ?? []) : [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(0, CATALOG_PRODUCT_LIMIT);
  const details = await Promise.all(
    ids.map((id) => client.get(`${client.base}/products/${encodeURIComponent(id)}`)),
  );
  // A failed detail fetch drops that product only; finding nothing at all
  // falls back to text search, so an outage here still surfaces downstream.
  const products = details
    .map((detail) => catalogProductSchema.safeParse(detail))
    .flatMap((result) => (result.success ? [result.data] : []));
  const nicknames = await sellerNicknames(client, products);
  const mapped = products
    .map((product) => catalogProductToMapped(product, source, ean, nicknames))
    .filter((entry): entry is MappedOffer => entry !== null);
  return { ok: true, mapped };
};

const cheapestShippingCents = (payload: unknown): number | null => {
  const parsed = shippingOptionsSchema.safeParse(payload);
  if (!parsed.success) return null;
  const costs = (parsed.data.options ?? [])
    .map((option) => centsOf(option.cost))
    .filter((cents): cents is number => cents !== null && cents >= 0);
  return costs.length === 0 ? null : Math.min(...costs);
};

/**
 * Per-CEP shipping estimates for the cheapest offers that don't already ship
 * free, bounded to keep the call count polite. Strictly best-effort: a failed
 * estimate leaves `shippingCents` undefined and never degrades the source.
 */
const enrichShippingByCep = async (
  client: MlClient,
  mapped: MappedOffer[],
  region: string | undefined,
): Promise<RawOffer[]> => {
  const cep = (region ?? '').replace(/\D/g, '');
  const lookups =
    cep.length !== 8
      ? []
      : mapped
          .filter(
            (entry): entry is MappedOffer & { itemId: string } =>
              entry.itemId !== null && entry.offer.shippingCents === undefined,
          )
          .sort((a, b) => (a.offer.priceCents ?? 0) - (b.offer.priceCents ?? 0))
          .slice(0, SHIPPING_LOOKUP_LIMIT);
  await Promise.all(
    lookups.map(async (entry) => {
      const payload = await client.get(
        `${client.base}/items/${encodeURIComponent(entry.itemId)}/shipping_options?zip_code=${cep}`,
      );
      const cents = payload === null ? null : cheapestShippingCents(payload);
      if (cents !== null) entry.offer.shippingCents = cents;
    }),
  );
  return mapped.map((entry) => entry.offer);
};

/**
 * GET with a bearer token, retried once with a freshly acquired token: the
 * host transport folds every failure — including a 401 on an expired or
 * revoked token — into null, so one re-auth attempt covers mid-run expiry and
 * a second null is a genuine outage (or persistent auth failure).
 */
const authedGet = async (
  auth: MercadoLivreAuth,
  ctx: ConnectorContext,
  url: string,
): Promise<unknown | null> => {
  const token = await auth.getAccessToken(ctx);
  if (token === null) return null;
  const payload = await ctx.fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  if (payload !== null) return payload;
  auth.invalidate();
  const fresh = await auth.getAccessToken(ctx);
  if (fresh === null || fresh === token) return null;
  return ctx.fetchJson(url, { headers: { Authorization: `Bearer ${fresh}` } });
};

export interface MercadoLivreConnectorOptions {
  auth: MercadoLivreAuth;
  /** Test seam; production is the public ML API. */
  apiBaseUrl?: string;
}

// Scans back from the end instead of matching /\/+$/. The regex is
// polynomial-time on a base URL that is mostly slashes (CodeQL: polynomial
// regular expression used on uncontrolled data), and apiBaseUrl comes from
// caller configuration.
const stripTrailingSlashes = (url: string): string => {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') {
    end -= 1;
  }
  return url.slice(0, end);
};

export const createMercadoLivreConnector = (
  options: MercadoLivreConnectorOptions,
): PriceSourceConnector => {
  const base = stripTrailingSlashes(options.apiBaseUrl ?? DEFAULT_ML_API_BASE_URL);
  const { auth } = options;

  return {
    type: 'MERCADO_LIVRE',
    async search(
      query: ResearchQuery,
      source: SourceRecord,
      ctx: ConnectorContext,
    ): Promise<ConnectorResult> {
      const config = configSchema.safeParse(source.config);
      if (!config.success) {
        return {
          ok: false,
          error: `invalid Mercado Livre config for source "${source.name}": ${config.error.message}`,
        };
      }
      const { siteId, minReputationLevel } = config.data;

      if ((await auth.getAccessToken(ctx)) === null) {
        return {
          ok: false,
          error: `Mercado Livre auth failed for source "${source.name}": no access token (check the host's Mercado Livre credentials)`,
        };
      }
      const client: MlClient = { base, get: (url) => authedGet(auth, ctx, url) };

      let mapped: MappedOffer[] = [];
      if (query.ean) {
        const viaCatalog = await searchCatalogByEan(client, query.ean, siteId, source);
        if (!viaCatalog.ok) return viaCatalog;
        mapped = viaCatalog.mapped;
      }
      // Text search is both the no-EAN path and the once-only fallback for an
      // EAN the catalog doesn't know. A fallback outage is still an outage.
      if (mapped.length === 0) {
        const viaText = await searchByText(client, query, siteId, minReputationLevel, source);
        if (!viaText.ok) return viaText;
        mapped = viaText.mapped;
      }

      return { ok: true, offers: await enrichShippingByCep(client, mapped, query.region) };
    },
  };
};
