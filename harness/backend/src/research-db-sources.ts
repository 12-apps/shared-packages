/**
 * The `price_sources` half of the research store: integrations, sources and the
 * credentials that hang off both.
 *
 * All three groups address ONE table, which is why they are together and why
 * the requests/manual groups are not. The ciphertext stops here — `scrubbed`
 * runs on every read, so the package is never handed a key it could log.
 */
import {
  integrationOf,
  INTEGRATION_TYPES,
  Params,
  scrubbed,
  sourceRow,
  type SourceRow,
  type SqlRunner,
} from './research-db-rows';
import type { ResearchCredentialRecord, ResearchHttpStore } from '@12-apps/product-research/http';

export function integrationsGroup(sql: SqlRunner): ResearchHttpStore['integrations'] {
  return {
  async list(clientId) {
    const params = new Params();
    const { rows } = await sql.query<SourceRow>(
      `SELECT id, type, name, config, enabled, status FROM price_sources
        WHERE client_id = ${params.add(clientId)} AND archived_at IS NULL
          AND type = ANY(${params.add([...INTEGRATION_TYPES])})
        ORDER BY type`,
      params.values,
    );
    return rows.map(integrationOf);
  },

  async save(clientId, type, record) {
    // ON CONFLICT over the package's own partial unique index: the
    // singleton invariant means a second save SWAPS the key rather than
    // adding a row, and letting the index decide is what keeps this host
    // from re-deriving which types are singletons.
    const params = new Params();
    const config = {
      credentialsEncrypted: record.credentialsEncrypted,
      credentialHint: record.credentialHint,
      credentialStatus: record.credentialStatus,
      checkedAt: record.checkedAt.toISOString(),
    };
    const { rows } = await sql.query<SourceRow>(
      `INSERT INTO price_sources (id, client_id, type, name, config, enabled, updated_at)
       VALUES (gen_random_uuid()::text, ${params.add(clientId)}, ${params.add(type)},
               ${params.add(type)}, ${params.add(JSON.stringify(config))},
               ${params.add(record.enabled)}, now())
       ON CONFLICT (client_id, type) WHERE type IN ('SERP','AMAZON','MERCADO_LIVRE')
       DO UPDATE SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = now()
       RETURNING id, type, name, config, enabled, status`,
      params.values,
    );
    const row = rows[0];
    if (!row) throw new Error('price_sources UPSERT returned no row');
    return integrationOf(row);
  },

  async setEnabled(clientId, type, enabled) {
    const params = new Params();
    const { rows } = await sql.query<SourceRow>(
      `UPDATE price_sources SET enabled = ${params.add(enabled)}, updated_at = now()
        WHERE client_id = ${params.add(clientId)} AND type = ${params.add(type)}
          AND archived_at IS NULL
        RETURNING id, type, name, config, enabled, status`,
      params.values,
    );
    const row = rows[0];
    if (!row) throw new Error(`no integration of type ${type}`);
    return integrationOf(row);
  },

  async remove(clientId, type) {
    const params = new Params();
    // Archived, not deleted: the soft-delete migration exists so a name can
    // be reused while the history that points at the row survives.
    await sql.query(
      `UPDATE price_sources SET archived_at = now(), updated_at = now()
        WHERE client_id = ${params.add(clientId)} AND type = ${params.add(type)}
          AND archived_at IS NULL`,
      params.values,
    );
  },
  };
}

export function sourcesGroup(sql: SqlRunner): ResearchHttpStore['sources'] {
  return {
  async list(clientId) {
    const params = new Params();
    const { rows } = await sql.query<SourceRow>(
      `SELECT id, type, name, config, enabled, status FROM price_sources
        WHERE client_id = ${params.add(clientId)} AND archived_at IS NULL
        ORDER BY name`,
      params.values,
    );
    return rows.map((row) => ({ ...row, config: scrubbed(row.config) }));
  },

  async create(clientId, body) {
    const input = (body ?? {}) as { type?: string; name?: string; config?: unknown };
    const params = new Params();
    const { rows } = await sql.query<SourceRow>(
      `INSERT INTO price_sources (id, client_id, type, name, config, updated_at)
       VALUES (gen_random_uuid()::text, ${params.add(clientId)},
               ${params.add(input.type ?? 'MANUAL')}, ${params.add(input.name ?? '')},
               ${params.add(JSON.stringify(input.config ?? {}))}, now())
       RETURNING id, type, name, config, enabled, status`,
      params.values,
    );
    const row = rows[0];
    if (!row) throw new Error('price_sources INSERT returned no row');
    return { ...row, config: scrubbed(row.config) };
  },

  async update(sourceId, clientId, body) {
    const input = (body ?? {}) as { name?: string; config?: unknown; enabled?: boolean };
    const params = new Params();
    const { rows } = await sql.query<SourceRow>(
      `UPDATE price_sources
          SET name = COALESCE(${params.add(input.name ?? null)}, name),
              config = COALESCE(${params.add(
                input.config === undefined ? null : JSON.stringify(input.config),
              )}::jsonb, config),
              enabled = COALESCE(${params.add(input.enabled ?? null)}, enabled),
              updated_at = now()
        WHERE id = ${params.add(sourceId)} AND client_id = ${params.add(clientId)}
          AND archived_at IS NULL
        RETURNING id, type, name, config, enabled, status`,
      params.values,
    );
    const row = rows[0];
    if (!row) throw new Error(`no source ${sourceId}`);
    return { ...row, config: scrubbed(row.config) };
  },

  async archive(sourceId, clientId) {
    const params = new Params();
    await sql.query(
      `UPDATE price_sources SET archived_at = now(), updated_at = now()
        WHERE id = ${params.add(sourceId)} AND client_id = ${params.add(clientId)}`,
      params.values,
    );
  },

  /** `null` is what lets the package answer its own 404 rather than throw. */
  async typeOf(sourceId, clientId) {
    return (await sourceRow(sql, sourceId, clientId))?.type ?? null;
  },
  };
}

export function credentialsGroup(sql: SqlRunner): ResearchHttpStore['credentials'] {
  return {
  async requireSource(sourceId, clientId) {
    const row = await sourceRow(sql, sourceId, clientId);
    if (!row) throw new Error(`no source ${sourceId}`);
    // Scrubbed on the way out, per the seam's own promise: the ciphertext
    // stops here, and the package never has to be trusted with it.
    return { type: row.type, config: scrubbed(row.config) };
  },

  async save(sourceId, clientId, record: ResearchCredentialRecord) {
    const params = new Params();
    const patch = {
      credentialsEncrypted: record.credentialsEncrypted,
      credentialHint: record.credentialHint,
      credentialStatus: record.credentialStatus,
      checkedAt: record.checkedAt.toISOString(),
    };
    const { rows } = await sql.query<SourceRow>(
      `UPDATE price_sources
          SET config = config || ${params.add(JSON.stringify(patch))}::jsonb,
              updated_at = now()
        WHERE id = ${params.add(sourceId)} AND client_id = ${params.add(clientId)}
        RETURNING id, type, name, config, enabled, status`,
      params.values,
    );
    const row = rows[0];
    if (!row) throw new Error(`no source ${sourceId}`);
    return { ...row, config: scrubbed(row.config) };
  },

  async remove(sourceId, clientId) {
    const params = new Params();
    const { rows } = await sql.query<SourceRow>(
      `UPDATE price_sources
          SET config = config - 'credentialsEncrypted' - 'credentialHint'
                       - 'credentialStatus' - 'checkedAt',
              updated_at = now()
        WHERE id = ${params.add(sourceId)} AND client_id = ${params.add(clientId)}
        RETURNING id, type, name, config, enabled, status`,
      params.values,
    );
    const row = rows[0];
    if (!row) throw new Error(`no source ${sourceId}`);
    return { ...row, config: scrubbed(row.config) };
  },
  };
}
