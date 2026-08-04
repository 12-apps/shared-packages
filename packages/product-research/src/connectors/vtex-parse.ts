import { z } from 'zod';

import { parseMoneyToCents } from '../normalize/money';
import type { RawOffer, SourceRecord } from '../types';
import type { DeliverySku } from './vtex-delivery';

/**
 * Reading a VTEX catalog answer into offers, split out of the connector when
 * the delivery verdict (FUT-514) landed: the search file was at its size
 * budget, and the payload shape is a self-contained concern — the same reason
 * `vtex-regions.ts` and `vtex-validate.ts` live beside it.
 */

// Loose objects on purpose: VTEX stores decorate the payload freely; we
// validate only what we read, and unknown fields must SURVIVE parsing because
// `raw` is the verbatim replay record for offline parser fixes.
const offerSchema = z.looseObject({
  Price: z.number().nullish(),
  ListPrice: z.number().nullish(),
  AvailableQuantity: z.number().nullish(),
});

const sellerSchema = z.looseObject({
  sellerId: z.string().nullish(),
  sellerName: z.string().nullish(),
  commertialOffer: offerSchema.nullish(),
});

const itemSchema = z.looseObject({
  // The SKU id, read for the delivery simulation (FUT-514) — it is how that
  // endpoint names an item, and the only key its answer can be matched by.
  itemId: z.string().nullish(),
  name: z.string().nullish(),
  ean: z.string().nullish(),
  images: z.array(z.looseObject({ imageUrl: z.string().nullish() })).nullish(),
  sellers: z.array(sellerSchema).nullish(),
});

const productSchema = z.looseObject({
  productName: z.string().nullish(),
  brand: z.string().nullish(),
  link: z.string().nullish(),
  linkText: z.string().nullish(),
  items: z.array(itemSchema).nullish(),
});

const responseSchema = z.array(productSchema);

// The intelligent-search API answers `{ products: [...] }` with the same
// product shape the legacy catalog search returns as a bare array.
const searchEnvelopeSchema = z.union([
  responseSchema,
  z.looseObject({ products: responseSchema }).transform((envelope) => envelope.products),
]);

export type VtexProducts = z.infer<typeof responseSchema>;

interface ParsedProduct {
  product: z.infer<typeof productSchema>;
  item: z.infer<typeof itemSchema>;
  priceCents: number;
  available: number;
}

/**
 * An offer beside the SKU the delivery simulation addresses it by (FUT-514).
 * The pairing stays INSIDE the connector: `RawOffer` is the persisted shape and
 * a store's internal sku/seller ids are not part of it.
 */
export interface OfferWithSku {
  offer: RawOffer;
  sku: DeliverySku | null;
}

const bestSellerOffer = (
  item: z.infer<typeof itemSchema>,
): { priceCents: number; available: number; sellerId?: string } | null => {
  const candidates = (item.sellers ?? [])
    .filter((seller) => Boolean(seller.commertialOffer))
    .map((seller) => ({
      priceCents: seller.commertialOffer?.Price
        ? (parseMoneyToCents(seller.commertialOffer.Price) ?? 0)
        : 0,
      available: seller.commertialOffer?.AvailableQuantity ?? 0,
      // Kept with the winning price: the simulation asks per (sku, seller), and
      // the seller that won on price is the one the offer quotes.
      sellerId: seller.sellerId ?? undefined,
    }))
    .filter((offer) => offer.priceCents > 0 && offer.available > 0);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, offer) => (offer.priceCents < best.priceCents ? offer : best));
};

const toRawOffer = (parsed: ParsedProduct, source: SourceRecord, baseUrl: string): RawOffer => {
  const { product, item } = parsed;
  const link =
    product.link ?? (product.linkText ? `${baseUrl.replace(/\/+$/, '')}/${product.linkText}/p` : undefined);
  return {
    supplierName: source.name,
    title: item.name ?? product.productName ?? '',
    url: link ?? undefined,
    imageUrl: item.images?.[0]?.imageUrl ?? undefined,
    ean: item.ean ?? undefined,
    currency: 'BRL',
    priceCents: parsed.priceCents,
    availability: 'IN_STOCK',
    raw: product,
  };
};

export const productsToPairs = (
  products: VtexProducts,
  source: SourceRecord,
  baseUrl: string,
): OfferWithSku[] =>
  products.flatMap((product) =>
    (product.items ?? []).flatMap((item) => {
      const best = bestSellerOffer(item);
      if (!best) return [];
      const offer = toRawOffer(
        { product, item, priceCents: best.priceCents, available: best.available },
        source,
        baseUrl,
      );
      // Both ids are required to ask about delivery; a store that publishes
      // neither simply cannot be asked, and its offers carry no claim.
      const sku =
        item.itemId && best.sellerId ? { skuId: item.itemId, sellerId: best.sellerId } : null;
      return [{ offer, sku }];
    }),
  );

export const parseVtexResponse = (
  payload: unknown,
  source: SourceRecord,
  baseUrl: string,
): RawOffer[] => parseVtexPairs(payload, source, baseUrl).map((pair) => pair.offer);

export const parseVtexPairs = (
  payload: unknown,
  source: SourceRecord,
  baseUrl: string,
): OfferWithSku[] => {
  const parsed = searchEnvelopeSchema.safeParse(payload);
  return parsed.success ? productsToPairs(parsed.data, source, baseUrl) : [];
};

/** The parsed products of one search answer, or `null` when it was nonsense. */
export const parseVtexProducts = (payload: unknown): VtexProducts | null => {
  const parsed = searchEnvelopeSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};
