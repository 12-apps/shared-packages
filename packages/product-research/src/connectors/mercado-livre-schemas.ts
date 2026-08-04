import { z } from 'zod';

/**
 * Mercado Livre payload schemas (FUT-417). Loose objects on purpose (same
 * doctrine as VTEX): we validate only what we read, and unknown fields must
 * SURVIVE parsing because `raw` is the verbatim replay record for offline
 * parser fixes.
 */

export const shippingSchema = z.looseObject({ free_shipping: z.boolean().nullish() });

const attributeSchema = z.looseObject({
  id: z.string().nullish(),
  value_name: z.string().nullish(),
});

const sellerSchema = z.looseObject({
  nickname: z.string().nullish(),
  seller_reputation: z.looseObject({ level_id: z.string().nullish() }).nullish(),
});

export const searchItemSchema = z.looseObject({
  id: z.string().nullish(),
  title: z.string().nullish(),
  price: z.number().nullish(),
  currency_id: z.string().nullish(),
  available_quantity: z.number().nullish(),
  condition: z.string().nullish(),
  permalink: z.string().nullish(),
  thumbnail: z.string().nullish(),
  seller: sellerSchema.nullish(),
  shipping: shippingSchema.nullish(),
  attributes: z.array(attributeSchema).nullish(),
});

export const searchResponseSchema = z.looseObject({
  results: z.array(searchItemSchema).nullish(),
});

export const catalogSearchSchema = z.looseObject({
  results: z.array(z.looseObject({ id: z.string().nullish() })).nullish(),
});

const buyBoxWinnerSchema = z.looseObject({
  item_id: z.string().nullish(),
  price: z.number().nullish(),
  currency_id: z.string().nullish(),
  available_quantity: z.number().nullish(),
  seller_id: z.number().nullish(),
  shipping: shippingSchema.nullish(),
});

export const catalogProductSchema = z.looseObject({
  id: z.string().nullish(),
  name: z.string().nullish(),
  permalink: z.string().nullish(),
  pictures: z.array(z.looseObject({ url: z.string().nullish() })).nullish(),
  buy_box_winner: buyBoxWinnerSchema.nullish(),
});

export const userSchema = z.looseObject({ nickname: z.string().nullish() });

export const shippingOptionsSchema = z.looseObject({
  options: z.array(z.looseObject({ cost: z.number().nullish() })).nullish(),
});

export type SearchItem = z.infer<typeof searchItemSchema>;
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type ShippingInfo = z.infer<typeof shippingSchema>;
