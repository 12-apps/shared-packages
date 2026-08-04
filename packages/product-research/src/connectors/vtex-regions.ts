import { z } from 'zod';

import { fetchJsonOutcome } from './fetch-reason';
import type { ConnectorContext, FetchInit } from './types';
import { vtexFailureMessage } from './vtex-errors';

/**
 * The VTEX automatic-regionalization probe (FUT-416), split out of the
 * connector when the failure-reason work (FUT-495) landed: the connector file
 * is at its size budget, and this is one endpoint with one verdict.
 */

const regionsSchema = z.array(
  z.looseObject({
    id: z.string().nullish(),
    sellers: z.array(z.looseObject({ id: z.string().nullish() })).nullish(),
  }),
);

type VtexRegion = { kind: 'served'; regionId: string } | { kind: 'unknown' };

/**
 * Ask the store which region serves a CEP. This answers only what the endpoint
 * can actually prove: a region id WITH sellers in it, which is what the
 * intelligent-search tier needs to price regionally. Everything else — endpoint
 * missing, malformed answer, partial CEP, a region carrying no sellers — is
 * `unknown`: no regional knowledge, fall back to the default-region search.
 *
 * It deliberately no longer reports "not served" (FUT-514). An empty `sellers`
 * array was read as a refusal and does not mean one: Apoio Entrega returns the
 * same region id with `sellers: []` for a CEP it demonstrably delivers to and
 * for one 3000 km outside its range, and Giga Atacado returns that IDENTICAL
 * id, which no two real regions could share. It is VTEX's "no seller-level
 * regionalization configured" sentinel, and inferring a refusal from it flagged
 * every offer of every such store as undeliverable. Deliverability is now asked
 * of the endpoint that can answer it — see `./vtex-delivery`.
 *
 * A failed probe stays `unknown` (the fallback is the whole point), but it is
 * no longer SILENT: the reason is logged with this tier's name, so a store
 * that regionalizes yet keeps 403-ing the probe is diagnosable instead of
 * looking like a store that simply has no regions API.
 *
 * `init` is the search's SHARED request identity (FUT-520), so this probe runs
 * under the same application key as the search it feeds — a probe that ran
 * anonymously beside a keyed search would answer for a different caller.
 */
export const resolveVtexRegion = async (
  ctx: ConnectorContext,
  baseUrl: string,
  region: string,
  init?: FetchInit,
): Promise<VtexRegion> => {
  const cep = region.replace(/\D/g, '');
  if (cep.length !== 8) return { kind: 'unknown' };
  const root = baseUrl.replace(/\/+$/, '');
  const url = `${root}/api/checkout/pub/regions?country=BRA&postalCode=${cep}`;
  const outcome = await fetchJsonOutcome(ctx, url, init);
  if (!outcome.ok) {
    ctx.logger.info(vtexFailureMessage('regions', outcome.failure, url, init !== undefined));
    return { kind: 'unknown' };
  }
  const parsed = regionsSchema.safeParse(outcome.payload);
  if (!parsed.success) return { kind: 'unknown' };
  const entry = parsed.data.find(
    (candidate) => typeof candidate.id === 'string' && candidate.id.length > 0,
  );
  if (!entry?.id) return { kind: 'unknown' };
  return (entry.sellers ?? []).length > 0 ? { kind: 'served', regionId: entry.id } : { kind: 'unknown' };
};
