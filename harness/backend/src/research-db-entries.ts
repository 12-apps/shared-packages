/**
 * The rows a research RUN produces, and the prices an operator types in.
 *
 * Separate from the price-source groups because they address different tables
 * and answer different questions: these are the history, those are the
 * configuration.
 */
import { Params, sourceRow, type SqlRunner } from './research-db-rows';
import type { NormalizedManualRow, ResearchHttpStore } from '@12-apps/product-research/http';

export function requestsGroup(sql: SqlRunner): ResearchHttpStore['requests'] {
  return {
  async create(clientId, input) {
    const params = new Params();
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO research_requests
         (id, client_id, term, brand, ean, quantity, region, catalog_ref_type,
          catalog_ref_id, requested_by)
       VALUES (gen_random_uuid()::text, ${params.add(clientId)}, ${params.add(input.term)},
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
      `SELECT r.id, r.term, r.quantity, r.region,
              run.id AS "runId", run.status AS "runStatus"
         FROM research_requests r
         LEFT JOIN research_runs run ON run.request_id = r.id
        WHERE r.id = ${params.add(requestId)} AND r.client_id = ${params.add(clientId)}
        ORDER BY run.created_at DESC LIMIT 1`,
      params.values,
    );
    return rows[0] ?? null;
  },

  async run(runId, clientId) {
    const params = new Params();
    const { rows } = await sql.query<Record<string, unknown>>(
      `SELECT id, status, source_stats AS "sourceStats"
         FROM research_runs
        WHERE id = ${params.add(runId)} AND client_id = ${params.add(clientId)}`,
      params.values,
    );
    return rows[0] ?? null;
  },

  /**
   * Durable row first, then the enqueue — which must NEVER throw.
   *
   * The package's own note: `enqueued: false` still answers 202, because a
   * reconciliation sweep re-enqueues run-less requests. This host has no
   * queue, so it always answers false — which is the honest answer and
   * exercises the branch a host with a healthy queue never reaches.
   */
  async enqueueRun() {
    return { enqueued: false };
  },
  };
}

export function manualGroup(sql: SqlRunner): ResearchHttpStore['manual'] {
  return {
  async requireSource(sourceId, clientId) {
    const row = await sourceRow(sourceId, clientId);
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
