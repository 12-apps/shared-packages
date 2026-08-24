/**
 * The BACKGROUND JOB, which is entirely the host's.
 *
 * `@12-apps/product-research`'s start route persists a request, calls
 * `enqueueRun` and answers 202 — and its own comment says why the accepted
 * answer cannot carry a run id: the run is created by the worker, later. So
 * every screen the UI package ships past the form (`ResearchRunScreen`, the
 * status rows, the ranked table, the degraded banner) renders rows a HOST
 * produced, and none of them can be exercised by a host that has no worker.
 *
 * This one is deliberate and small: it settles a run synchronously when a
 * suite asks it to, so the poll the run screen performs resolves the same way
 * a real deploy's does — the request answers `latestRun: null` until this runs,
 * then a COMPLETED run with stats and offers.
 *
 * Two things it produces on purpose:
 *
 * - **a FAILED source beside the OK ones.** Degradation is the case the run
 *   screen is built around — a failed source is a banner, never a silently
 *   shorter list — and a worker that always succeeded would leave that path
 *   unrendered in the one place the published component is actually mounted.
 * - **a null `shippingCents` on one offer.** FUT-518: null means the source
 *   never stated a shipping cost, so `totalCents` is a LOWER BOUND and the
 *   surface must caveat it. Nullable rather than optional, because absent
 *   would mean the read forgot it — which a host whose worker always writes 0
 *   would never discover.
 */
import type { PGlite } from '@electric-sql/pglite';

import { Params, type SqlRunner } from './rbac-db-shared';

/** What one settled source contributed, in the package's own stat vocabulary. */
interface SourceOutcome {
  name: string;
  status: 'OK' | 'FAILED';
  unitPriceCents: number;
  shippingCents: number | null;
  error?: string;
}

const OUTCOMES: readonly SourceOutcome[] = [
  { name: 'Distribuidora Central', status: 'OK', unitPriceCents: 480, shippingCents: 1200 },
  // The cheaper unit price with NO stated shipping — so the two offers cannot
  // be ordered by unit price alone and the caveat has something to sit on.
  { name: 'Atacado Litoral', status: 'OK', unitPriceCents: 430, shippingCents: null },
  { name: 'Mercado Norte', status: 'FAILED', unitPriceCents: 0, shippingCents: 0, error: 'tempo esgotado' },
];

interface RequestRow {
  id: string;
  term: string;
  quantity: number;
}

/**
 * Settle the request's run, or answer `null` if there is no such request.
 *
 * Idempotent by request: a second call replaces the run rather than stacking a
 * second one, so a suite can drive the same request twice without the history
 * list growing a duplicate.
 */
export async function settleResearchRun(
  pg: PGlite,
  requestId: string,
  clientId: string,
): Promise<string | null> {
  const sql = pg as unknown as SqlRunner;
  const lookup = new Params();
  const { rows } = await sql.query<RequestRow>(
    `SELECT id, term, quantity FROM research_requests
      WHERE id = ${lookup.add(requestId)} AND client_id = ${lookup.add(clientId)}`,
    lookup.values,
  );
  const request = rows[0];
  if (request === undefined) return null;

  const clear = new Params();
  // Offers cascade with the run, so one delete is the whole reset.
  await sql.query(
    `DELETE FROM research_runs WHERE request_id = ${clear.add(requestId)}`,
    clear.values,
  );

  const runId = await insertRun(sql, request, clientId);
  await insertOffers(sql, runId, request, clientId);
  return runId;
}

async function insertRun(sql: SqlRunner, request: RequestRow, clientId: string): Promise<string> {
  const stats = OUTCOMES.map((outcome, index) => ({
    sourceId: `stub-${index}`,
    type: 'SERP',
    name: outcome.name,
    status: outcome.status,
    offerCount: outcome.status === 'OK' ? 1 : 0,
    ms: 120 + index * 40,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  }));
  const params = new Params();
  const { rows } = await sql.query<{ id: string }>(
    `INSERT INTO research_runs
       (id, client_id, request_id, status, source_stats, started_at, finished_at, updated_at)
     VALUES (gen_random_uuid()::text, ${params.add(clientId)}, ${params.add(request.id)},
             'COMPLETED', ${params.add(JSON.stringify(stats))}::jsonb, now(), now(), now())
     RETURNING id`,
    params.values,
  );
  const runId = rows[0]?.id;
  if (runId === undefined) throw new Error('research_runs INSERT returned no row');
  return runId;
}

async function insertOffers(
  sql: SqlRunner,
  runId: string,
  request: RequestRow,
  clientId: string,
): Promise<void> {
  const succeeded = OUTCOMES.filter((outcome) => outcome.status === 'OK');
  // Ranked by what the buyer actually pays for the quantity asked for, with an
  // unstated shipping counted as zero — which is exactly why that offer's total
  // is a lower bound rather than a comparison.
  const ranked = succeeded
    .map((outcome) => ({
      outcome,
      totalCents: outcome.unitPriceCents * request.quantity + (outcome.shippingCents ?? 0),
    }))
    .sort((a, b) => a.totalCents - b.totalCents);

  for (const [index, { outcome, totalCents }] of ranked.entries()) {
    const params = new Params();
    await sql.query(
      `INSERT INTO supplier_offers
         (id, client_id, run_id, source_type, supplier_name, title, url, currency,
          price_cents, shipping_cents, pack_quantity, unit_price_cents, total_cents,
          availability, relevance_score, rank)
       VALUES (gen_random_uuid()::text, ${params.add(clientId)}, ${params.add(runId)}, 'SERP',
               ${params.add(outcome.name)}, ${params.add(`${request.term} — ${outcome.name}`)},
               ${params.add(`https://exemplo.invalid/${index}`)}, 'BRL',
               ${params.add(outcome.unitPriceCents)}, ${params.add(outcome.shippingCents)}, 1,
               ${params.add(outcome.unitPriceCents)}, ${params.add(totalCents)},
               'IN_STOCK', ${params.add(1 - index * 0.1)}, ${params.add(index + 1)})`,
      params.values,
    );
  }
}
