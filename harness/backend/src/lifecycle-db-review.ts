/**
 * The drafts + change-requests delegates of the lifecycle-db seam (12-17) —
 * split from `lifecycle-db.ts` along the same line the package splits its own
 * service (`service-review.ts`): the review half of the machinery.
 */
import { randomUUID } from 'node:crypto';

import type {
  ChangeRequestDelegate,
  ChangeRequestRow,
  EntityDraftDelegate,
  EntityDraftRow,
} from '@12-apps/entity-lifecycle/server';

import { Params, type SqlRunner } from './rbac-db-shared';

interface DraftSqlRow {
  id: string;
  client_id: string;
  entity_type: string;
  entity_id: string | null;
  data: unknown;
  status: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const draftRow = (row: DraftSqlRow): EntityDraftRow => ({
  id: row.id,
  clientId: row.client_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  data: row.data,
  status: row.status,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function draftWhereSql(
  where: { clientId: string; id?: string; entityType?: string; entityId?: string; status?: string },
  params: Params,
): string {
  const conditions = [`client_id = ${params.add(where.clientId)}`];
  if (where.id !== undefined) conditions.push(`id = ${params.add(where.id)}`);
  if (where.entityType !== undefined) {
    conditions.push(`entity_type = ${params.add(where.entityType)}`);
  }
  if (where.entityId !== undefined) conditions.push(`entity_id = ${params.add(where.entityId)}`);
  if (where.status !== undefined) conditions.push(`status = ${params.add(where.status)}`);
  return conditions.join(' AND ');
}

export function draftDelegate(sql: SqlRunner): EntityDraftDelegate {
  return {
    async create({ data }) {
      const params = new Params();
      const { rows } = await sql.query<DraftSqlRow>(
        `INSERT INTO entity_drafts
           (id, client_id, entity_type, entity_id, data, created_by, updated_by, updated_at)
         VALUES (${params.add(randomUUID())}, ${params.add(data.clientId)},
                 ${params.add(data.entityType)}, ${params.add(data.entityId)},
                 ${params.add(JSON.stringify(data.data))}::jsonb,
                 ${params.add(data.createdBy)}, ${params.add(data.updatedBy)}, NOW())
         RETURNING *`,
        params.values,
      );
      return draftRow(rows[0] as DraftSqlRow);
    },
    async update({ where, data }) {
      const params = new Params();
      const { rows } = await sql.query<DraftSqlRow>(
        `UPDATE entity_drafts
           SET data = ${params.add(JSON.stringify(data.data))}::jsonb,
               updated_by = ${params.add(data.updatedBy)}, updated_at = NOW()
         WHERE id = ${params.add(where.id)}
         RETURNING *`,
        params.values,
      );
      const row = rows[0];
      if (!row) throw new Error(`Draft ${where.id} not found`);
      return draftRow(row);
    },
    async findFirst({ where }) {
      const params = new Params();
      const { rows } = await sql.query<DraftSqlRow>(
        `SELECT * FROM entity_drafts WHERE ${draftWhereSql(where, params)} LIMIT 1`,
        params.values,
      );
      const row = rows[0];
      return row ? draftRow(row) : null;
    },
    async findMany({ where, orderBy }) {
      const params = new Params();
      const { rows } = await sql.query<DraftSqlRow>(
        `SELECT * FROM entity_drafts WHERE ${draftWhereSql(where, params)}
         ORDER BY updated_at ${orderBy.updatedAt === 'asc' ? 'ASC' : 'DESC'}, id`,
        params.values,
      );
      return rows.map(draftRow);
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const clause = draftWhereSql(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE entity_drafts
           SET status = ${params.add(data.status)}, updated_at = NOW()
         WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}

interface RequestSqlRow {
  id: string;
  client_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload: unknown;
  status: string;
  requested_by: string | null;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
}

const requestRow = (row: RequestSqlRow): ChangeRequestRow => ({
  id: row.id,
  clientId: row.client_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  action: row.action,
  payload: row.payload,
  status: row.status,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  decisionNote: row.decision_note,
});

export function requestDelegate(sql: SqlRunner): ChangeRequestDelegate {
  return {
    async create({ data }) {
      const params = new Params();
      const { rows } = await sql.query<RequestSqlRow>(
        `INSERT INTO change_requests
           (id, client_id, entity_type, entity_id, action, payload, requested_by)
         VALUES (${params.add(randomUUID())}, ${params.add(data.clientId)},
                 ${params.add(data.entityType)}, ${params.add(data.entityId)},
                 ${params.add(data.action)}, ${params.add(JSON.stringify(data.payload))}::jsonb,
                 ${params.add(data.requestedBy)})
         RETURNING *`,
        params.values,
      );
      return requestRow(rows[0] as RequestSqlRow);
    },
    async findFirst({ where }) {
      const params = new Params();
      const { rows } = await sql.query<RequestSqlRow>(
        `SELECT * FROM change_requests WHERE ${draftWhereSql(where, params)} LIMIT 1`,
        params.values,
      );
      const row = rows[0];
      return row ? requestRow(row) : null;
    },
    async findMany({ where, orderBy }) {
      const params = new Params();
      const { rows } = await sql.query<RequestSqlRow>(
        `SELECT * FROM change_requests WHERE ${draftWhereSql(where, params)}
         ORDER BY requested_at ${orderBy.requestedAt === 'asc' ? 'ASC' : 'DESC'}, id`,
        params.values,
      );
      return rows.map(requestRow);
    },
    async updateMany({ where, data }) {
      const params = new Params();
      const clause = draftWhereSql(where, params);
      const { affectedRows } = await sql.query(
        `UPDATE change_requests
           SET status = ${params.add(data.status)}, decided_by = ${params.add(data.decidedBy)},
               decided_at = ${params.add(data.decidedAt)},
               decision_note = ${params.add(data.decisionNote)}
         WHERE ${clause}`,
        params.values,
      );
      return { count: affectedRows ?? 0 };
    },
  };
}
