/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the assets
   inside the PUBLISHED @12-apps/mcp tarball apply to a real Postgres. Every path
   read is inside the installed package and the database is a fresh in-process
   PGlite per test. */
/* eslint-disable test-flakiness/no-test-isolation -- `db` is a PARAMETER handed to
   each case by `withMigrated`, which opens one database per case and closes it in a
   finally; the rule matches the identifier across the file rather than its scope.
   Isolation is what the helper exists to guarantee. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/mcp ships the three tables behind its authorization server (12-23) —
 * the port of the origin host's `oauth-schema.integration.test.ts`, asserted against
 * the tarball.
 *
 * Two properties matter more than the rest: the migration REPLAYS (the origin host
 * already has these tables, so adoption is a no-op or it is a failed deploy), and
 * there is deliberately NO code table — authorization codes are stateless signed
 * blobs, so a host inheriting an `oauth_codes` table would be inheriting a
 * misunderstanding.
 */
const mcpPackage = fileURLToPath(new URL('../node_modules/@12-apps/mcp/', import.meta.url));
const migrationsDir = join(mcpPackage, 'prisma/migrations');

function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sqlOf(name: string): string {
  return readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
}

/**
 * Run `body` against a freshly migrated database, and close it whichever way the
 * body ends.
 *
 * The database arrives as an ARGUMENT rather than as a local in each case: one
 * per test is what keeps them order-independent, and passing it in is what makes
 * that visible instead of relying on every case remembering its own teardown.
 */
async function withMigrated(body: (db: PGlite) => Promise<void>): Promise<void> {
  const db = new PGlite();
  try {
    for (const name of migrations()) await db.exec(sqlOf(name));
    await body(db);
  } finally {
    await db.close();
  }
}

const MCP_TABLES = ['oauth_clients', 'oauth_refresh_tokens', 'mcp_connections'];

describe('@12-apps/mcp — the prisma assets survive publication', () => {
  it('ships the schema partial with all three models', () => {
    const partial = readFileSync(join(mcpPackage, 'prisma/mcp.prisma'), 'utf-8');
    for (const model of ['OAuthClient', 'OAuthRefreshToken', 'McpConnection']) {
      expect(partial).toMatch(new RegExp(`model\\s+${model}\\s`));
    }
    // No relations: the package cannot name a host's user model.
    expect(partial).not.toMatch(/@relation/);
  });

  it('ships the prisma:sync script the adoption contract names', () => {
    const script = readFileSync(join(mcpPackage, 'scripts/sync-mcp-schema.mjs'), 'utf-8');
    expect(script).toContain('mcp.prisma');
  });

  it('ships at least one non-empty migration', () => {
    expect(migrations().length).toBeGreaterThan(0);
    expect(migrations().filter((name) => sqlOf(name).trim().length === 0)).toEqual([]);
  });

  it('creates the three tables and no code table', async () => {
    await withMigrated(async (db) => {
      const { rows } = await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const tables = rows.map((row) => row.table_name);
      for (const table of MCP_TABLES) expect(tables).toContain(table);
      expect(tables).not.toContain('oauth_codes');
    });
  });

  it('creates the lookup indexes the AS reads on every request', async () => {
    await withMigrated(async (db) => {
      const { rows } = await db.query<{ indexname: string; tablename: string }>(
        `SELECT indexname, tablename FROM pg_indexes
          WHERE tablename IN ('oauth_clients', 'oauth_refresh_tokens', 'mcp_connections')`,
      );
      const names = rows.map((row) => row.indexname);
      expect(names).toContain('oauth_clients_client_id_key');
      expect(names).toContain('oauth_refresh_tokens_token_hash_key');
      expect(names).toContain('oauth_refresh_tokens_user_email_client_id_idx');
      expect(names).toContain('mcp_connections_user_id_oauth_client_id_key');
    });
  });

  it('round-trips a client including its TEXT[] columns', async () => {
    await withMigrated(async (db) => {
      await db.query(
        `INSERT INTO oauth_clients
           (id, client_id, redirect_uris, grant_types, scopes, updated_at)
         VALUES ('c1', 'cid-1', ARRAY['https://claude.ai/cb'],
                 ARRAY['authorization_code','refresh_token'], ARRAY['mcp:read'], NOW())`,
      );
      const { rows } = await db.query<{ redirect_uris: string[]; scopes: string[] }>(
        `SELECT redirect_uris, scopes FROM oauth_clients WHERE client_id = 'cid-1'`,
      );
      expect(rows[0]?.redirect_uris).toEqual(['https://claude.ai/cb']);
      expect(rows[0]?.scopes).toEqual(['mcp:read']);
      // A public PKCE client has no secret at all, hash included.
      const { rows: secretless } = await db.query<{ client_secret_hash: string | null }>(
        `SELECT client_secret_hash FROM oauth_clients WHERE client_id = 'cid-1'`,
      );
      expect(secretless[0]?.client_secret_hash).toBeNull();
    });
  });

  it('enforces the auth-method domain and the unique client_id', async () => {
    await withMigrated(async (db) => {
      await db.query(
        `INSERT INTO oauth_clients (id, client_id, updated_at) VALUES ('c1', 'cid-1', NOW())`,
      );
      await expect(
        db.query(
          `INSERT INTO oauth_clients (id, client_id, updated_at) VALUES ('c2', 'cid-1', NOW())`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      await expect(
        db.query(
          `INSERT INTO oauth_clients (id, client_id, token_endpoint_auth_method, updated_at)
           VALUES ('c3', 'cid-3', 'private_key_jwt', NOW())`,
        ),
      ).rejects.toThrow(/check|constraint/i);
    });
  });

  it('enforces the unique token_hash — a duplicate is never a second live token', async () => {
    await withMigrated(async (db) => {
      const insert = (id: string): Promise<unknown> =>
        db.query(
          `INSERT INTO oauth_refresh_tokens
             (id, token_hash, user_email, user_sub, client_id, expires_at)
           VALUES ($1, 'hash-1', 'ana@harness.dev', 'sub-1', 'cid-1', NOW() + INTERVAL '30 days')`,
          [id],
        );
      await insert('t1');
      await expect(insert('t2')).rejects.toThrow(/unique|duplicate/i);
    });
  });

  it('allows one connection per (user, client) and keeps users apart', async () => {
    await withMigrated(async (db) => {
      await db.query(
        `INSERT INTO mcp_connections (id, user_id, oauth_client_id) VALUES ('m1', 'u1', 'cid-1')`,
      );
      await expect(
        db.query(
          `INSERT INTO mcp_connections (id, user_id, oauth_client_id) VALUES ('m2', 'u1', 'cid-1')`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      // A second user connecting the same AI host is a different row.
      await db.query(
        `INSERT INTO mcp_connections (id, user_id, oauth_client_id) VALUES ('m3', 'u2', 'cid-1')`,
      );
      // `host` is nullable: a connection can exist before attribution.
      const { rows } = await db.query<{ host: string | null }>(
        `SELECT host FROM mcp_connections WHERE id = 'm1'`,
      );
      expect(rows[0]?.host).toBeNull();
    });
  });

  it('replays into a schema that already has the tables', async () => {
    await withMigrated(async (db) => {
      for (const name of migrations()) {
        await expect(db.exec(sqlOf(name)), `replay ${name}`).resolves.toBeDefined();
      }
    });
  });
});
