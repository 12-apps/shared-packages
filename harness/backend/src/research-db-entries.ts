/**
 * The rows a research RUN produces, and the prices an operator types in.
 *
 * Separate from the price-source groups because they address different tables
 * and answer different questions: these are the history, those are the
 * configuration.
 */
import { normalizeText } from '@12-apps/product-research';
import type { NormalizedManualRow, ResearchHttpStore } from '@12-apps/product-research/http';

import { Params, sourceRow, type SqlRunner } from './research-db-rows';
import {
  LATEST_RUN_JOIN,
  OFFER_VIEW_COLUMNS,
  REQUEST_VIEW_COLUMNS,
  toRequestView,
  toRunView,
} from './research-views';

/**
 * The history rows.
 *
 * `term_normalized` is written HERE, by the host, because the package's own
 * migration says so — it backfills the column once and leaves it "kept in sync
 * by the host on write". The value comes from the package's exported
 * `normalizeText`, never from a second implementation beside it: the column
 * exists so a lookup finds a term past renames and accent variants, and a host
 * that folded accents its own way would index rows its own search could not
 * find. The column is nullable and no write path fails without it, so the
 * omission is silent — which is why the listing suite asserts an accented term
 * is found by its unaccented spelling rather than asserting the column.
 */
export function requestsGroup(
  sql: SqlRunner,
  enqueue: ResearchHttpStore['requests']['enqueueRun'],
): ResearchHttpStore['requests'] {
  return {
  async create(clientId, input) {
    const params = new Params();
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO research_requests
         (id, client_id, term, term_normalized, brand, ean, quantity, region,
          catalog_ref_type, catalog_ref_id, requested_by)
       VALUES (gen_random_uuid()::text, ${params.add(clientId)}, ${params.add(input.term)},
               ${params.add(normalizeText(input.term))},
               ${params.add(input.brand ?? null)}, ${params.add(input.ean ?? null)},
               ${params.add(input.quantity)}, ${params.add(input.region ?? null)},
               ${params.add(input.catalogRefType ?? null)},
               ${params.add(input.catalogRefId ?? null)},
               ${params.add(input.requestedBy)})
       RETURNING id`,
      params.values,
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('research_requests INSERT returned no row');
    return { id };
  },

  async view(requestId, clientId) {
    const params = new Params();
    const { rows } = await sql.query<Record<string, unknown>>(
      `SELECT ${REQUEST_VIEW_COLUMNS}
         FROM research_requests r
         ${LATEST_RUN_JOIN}
        WHERE r.id = ${params.add(requestId)} AND r.client_id = ${params.add(clientId)}`,
      params.values,
    );
    const row = rows[0];
    return row === undefined ? null : toRequestView(row);
  },

  async run(runId, clientId) {
    const params = new Params();
    const { rows } = await sql.query<Record<string, unknown>>(
      `SELECT id, request_id AS "requestId", status, source_stats AS "sourceStats",
              error, started_at AS "startedAt", finished_at AS "finishedAt"
         FROM research_runs
        WHERE id = ${params.add(runId)} AND client_id = ${params.add(clientId)}`,
      params.values,
    );
    const row = rows[0];
    if (row === undefined) return null;
    const offerParams = new Params();
    const { rows: offers } = await sql.query<Record<string, unknown>>(
      // NULLS LAST: an unranked offer is one the ranker never reached, and it
      // belongs under the ranked ones rather than above them.
      `SELECT ${OFFER_VIEW_COLUMNS}
         FROM supplier_offers
        WHERE run_id = ${offerParams.add(runId)} AND hidden_at IS NULL
        ORDER BY rank ASC NULLS LAST`,
      offerParams.values,
    );
    return toRunView(row, offers);
  },

  /**
   * Durable row first, then the enqueue — which must NEVER throw.
   *
   * The enqueue itself is the HOST's (`research-worker.ts`): the package's own
   * note is that `enqueued: false` still answers 202, because a reconciliation
   * sweep re-enqueues run-less requests. So this is a seam a host fills with
   * its queue, and the harness fills it with an INLINE worker — the same choice
   * it makes for realtime, and the thing that makes the run screen's poll
   * resolve here the way it resolves on a deploy.
   */
  enqueueRun: enqueue,
  };
}

export function manualGroup(sql: SqlRunner): ResearchHttpStore['manual'] {
  return {
  async requireSource(sourceId, clientId) {
    const row = await sourceRow(sql, sourceId, clientId);
    if (!row) throw new Error(`no source ${sourceId}`);
    return { id: row.id, name: row.name };
  },

  async listPrices(clientId, sourceId, query) {
    const params = new Params();
    const { rows } = await sql.query<Record<string, unknown>>(
      `SELECT id, title, price_cents AS "priceCents", supplier_name AS "supplierName"
         FROM manual_price_entries
        WHERE client_id = ${params.add(clientId)} AND source_id = ${params.add(sourceId)}
        ORDER BY created_at DESC
        LIMIT ${params.add(query.pageSize)} OFFSET ${params.add(
          (query.page - 1) * query.pageSize,
        )}`,
      params.values,
    );
    return { data: rows, pagination: { page: query.page, pageSize: query.pageSize } };
  },

  async store(input) {
    const batchId = `batch-${Date.now()}`;
    if (input.replace) {
      const params = new Params();
      await sql.query(
        `DELETE FROM manual_price_entries
          WHERE client_id = ${params.add(input.clientId)}
            AND source_id = ${params.add(input.sourceId)}`,
        params.values,
      );
    }
    for (const entry of input.entries as NormalizedManualRow[]) {
      const params = new Params();
      await sql.query(
        `INSERT INTO manual_price_entries
           (id, client_id, source_id, batch_id, supplier_name, title, brand, ean,
            pack_quantity, price_cents, created_at)
         VALUES (gen_random_uuid()::text, ${params.add(input.clientId)},
                 ${params.add(input.sourceId)}, ${params.add(batchId)},
                 ${params.add(entry.supplierName ?? input.defaultSupplierName)},
                 ${params.add(entry.title)}, ${params.add(entry.brand ?? null)},
                 ${params.add(entry.ean ?? null)}, ${params.add(entry.packQuantity ?? null)},
                 ${params.add(entry.priceCents)}, now())`,
        params.values,
      );
    }
    return { imported: input.entries.length, batchId, replaced: input.replace };
  },
  };
}
