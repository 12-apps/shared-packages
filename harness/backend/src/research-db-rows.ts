/**
 * The row layer shared by the research store's groups.
 *
 * Split out for the reason `rbac-db.ts` splits into `rbac-db-roles.ts` and
 * `rbac-db-team.ts`: the seam has four groups over five tables, and one
 * factory holding all of them says nothing about which table each touches.
 * What every group needs in common is here — the price-source row, the scrub
 * that keeps a ciphertext from travelling, and the roster shape.
 */
import type { PGlite } from '@electric-sql/pglite';

import { Params, type SqlRunner } from './rbac-db-shared';

/** A price-source row as this host's clients read it. */
export interface SourceRow {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  status: string;
}

/** The stored config with the ciphertext removed — never the value. */
export function scrubbed(config: Record<string, unknown>): Record<string, unknown> {
  const { credentialsEncrypted: _secret, ...rest } = config;
  return rest;
}

/** The roster shape: the HINT rides out, the ciphertext does not. */
export function integrationOf(row: SourceRow): Record<string, unknown> {
  return {
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    status: row.status,
    credentialHint: row.config['credentialHint'] ?? null,
    credentialStatus: row.config['credentialStatus'] ?? 'UNVERIFIED',
  };
}

/** The integration types this package treats as at-most-one-per-tenant. */
export const INTEGRATION_TYPES = ['SERP', 'AMAZON', 'MERCADO_LIVRE'] as const;

/** One live source of one client, or undefined. */
export async function sourceRow(
  sql: SqlRunner,
  id: string,
  clientId: string,
): Promise<SourceRow | undefined> {
  const params = new Params();
  const { rows } = await sql.query<SourceRow>(
    `SELECT id, type, name, config, enabled, status FROM price_sources
     WHERE id = ${params.add(id)} AND client_id = ${params.add(clientId)}
       AND archived_at IS NULL`,
    params.values,
  );
  return rows[0];
}

export { Params };
export type { SqlRunner, PGlite };
