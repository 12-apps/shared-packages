import { z } from 'zod';

import type { ConnectorContext, FetchInit } from './types';
import { diagnosticsOf } from './types';
import { vtexFailureMessage } from './vtex-errors';

/**
 * Does this store actually deliver these SKUs to this CEP? (FUT-514)
 *
 * The question used to be asked of `/api/checkout/pub/regions`, whose empty
 * `sellers` array was read as "does not serve here". Measured against live
 * stores, that answer carries NO signal: Apoio Entrega returns the identical
 * body — the same region id, `sellers: []` — for Belo Horizonte (which it
 * demonstrably serves), São Paulo, Rio and Rio Branco 3000km away; Giga Atacado
 * returns the SAME region id as Apoio, which no two real regions could. That id
 * is VTEX's "no seller-level regionalization configured" sentinel, and reading
 * it as a refusal flagged every offer of every such store as undeliverable.
 *
 * `orderForms/simulation` is the endpoint that does answer. It discriminates
 * exactly: for the reported SKU it returns two delivery SLAs for the buyer's
 * CEP and zero, with "não pode ser entregue para o CEP selecionado", for every
 * CEP the store does not reach.
 *
 * Two properties of that endpoint shape this module:
 *
 * - It BATCHES. Every SKU of a search travels in one request, so the delivery
 *   verdict costs one extra exchange per source per search, not one per offer.
 * - It DROPS what it cannot sell. A SKU absent from the answer is not aligned
 *   with a hole in the array — the array is simply shorter — so the verdict is
 *   matched by `items[].id` and NEVER positionally against the request.
 *
 * It also needs the store's real sales channel: on the wrong one the simulation
 * answers "não tem estoque" for every CEP including served ones, which would
 * flag everything exactly like the bug this replaces. That is why an
 * indeterminate answer here claims NOTHING rather than guessing.
 */

const simulationSchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string().nullish() })).nullish(),
  logisticsInfo: z
    .array(z.looseObject({ slas: z.array(z.looseObject({})).nullish() }).nullish())
    .nullish(),
});

/** One SKU as the simulation addresses it: the item and the seller offering it. */
export interface DeliverySku {
  skuId: string;
  sellerId: string;
}

const simulationUrl = (baseUrl: string, salesChannel: string | undefined): string => {
  const root = baseUrl.replace(/\/+$/, '');
  const channel = salesChannel === undefined ? '' : `?sc=${encodeURIComponent(salesChannel)}`;
  return `${root}/api/checkout/pub/orderForms/simulation${channel}`;
};

/**
 * Which of `skus` the store will deliver to `region`, or `null` when the
 * question could not be answered — no CEP, nothing to ask about, a host with no
 * POST seam, a refused or malformed answer.
 *
 * `null` is not "nothing is deliverable": every caller must read it as "make no
 * delivery claim". The whole defect this replaces was a probe that could not
 * tell, reporting a definite verdict anyway.
 *
 * `init` carries the search's shared application key (FUT-520). This arm needs
 * no redirect worry: the host's `guardedRedirectTarget` refuses to follow a
 * redirect on a non-GET at all, so a credential sent here can never cross a
 * host — the exchange is refused first.
 */
export const deliverableSkus = async (
  ctx: ConnectorContext,
  baseUrl: string,
  salesChannel: string | undefined,
  region: string,
  skus: DeliverySku[],
  init?: FetchInit,
): Promise<Set<string> | null> => {
  const cep = region.replace(/\D/g, '');
  if (cep.length !== 8 || skus.length === 0 || !ctx.postJsonResult) return null;

  const url = simulationUrl(baseUrl, salesChannel);
  const outcome = await ctx.postJsonResult(
    url,
    {
      items: skus.map((sku) => ({ id: sku.skuId, quantity: 1, seller: sku.sellerId })),
      postalCode: cep,
      country: 'BRA',
    },
    init,
  );
  if (!outcome.ok) {
    ctx.logger.info(vtexFailureMessage('simulation', outcome.failure, url, diagnosticsOf(ctx), init !== undefined));
    return null;
  }

  const parsed = simulationSchema.safeParse(outcome.payload);
  if (!parsed.success) return null;
  const items = parsed.data.items ?? [];
  const logistics = parsed.data.logisticsInfo ?? [];

  // `items[i]` and `logisticsInfo[i]` are aligned with EACH OTHER — that pairing
  // is the store's own, and the only positional read that is safe here.
  const deliverable = new Set<string>();
  items.forEach((item, index) => {
    const slas = logistics[index]?.slas ?? [];
    if (typeof item.id === 'string' && item.id.length > 0 && slas.length > 0) {
      deliverable.add(item.id);
    }
  });
  return deliverable;
};
