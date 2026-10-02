import type { PGlite } from "@electric-sql/pglite";
import type { McpConnectionStore, StoredMcpConnection } from "@12-apps/mcp/oauth";

interface ConnectionRaw {
  oauth_client_id: string;
  client_name: string | null;
  host: string | null;
  connected_at: Date;
  last_active_at: Date;
}

function toConnection(raw: ConnectionRaw): StoredMcpConnection {
  return {
    oauthClientId: raw.oauth_client_id,
    clientName: raw.client_name,
    host: raw.host,
    connectedAt: new Date(raw.connected_at),
    lastActiveAt: new Date(raw.last_active_at),
  };
}

export function connectionStore(pg: PGlite): McpConnectionStore {
  return {
    async lastActiveAt(userId, oauthClientId) {
      const { rows } = await pg.query<{ last_active_at: Date }>(
        `SELECT last_active_at FROM mcp_connections
         WHERE user_id = $1 AND oauth_client_id = $2 AND revoked_at IS NULL`,
        [userId, oauthClientId],
      );
      return rows[0] ? new Date(rows[0].last_active_at) : null;
    },

    recordActivity: (input) => recordActivity(pg, input),
    disconnect: (userId, email, host) => pg.transaction(async (tx) => {
      const disconnectedClientIds = await revokeByHost(tx, userId, host);
      const revoked = await tx.query(
        `UPDATE oauth_refresh_tokens SET revoked_at = NOW(), grace_seal = NULL
         WHERE user_email = $1 AND client_id = ANY($2) AND revoked_at IS NULL`,
        [email, disconnectedClientIds],
      );
      return { disconnectedClientIds, revokedRefreshTokens: revoked.affectedRows ?? 0 };
    }),

    async listActive(userId) {
      const { rows } = await pg.query<ConnectionRaw>(
        `SELECT oauth_client_id, client_name, host, connected_at, last_active_at
         FROM mcp_connections
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY last_active_at DESC`,
        [userId],
      );
      return rows.map(toConnection);
    },

    revokeByHost: (userId, host) => revokeByHost(pg, userId, host),
    announce: (userId, host) => announce(pg, userId, host),
  };
}

/** Every read and write scoped by `user_id` — a connection is per-user, always. */
async function revokeByHost(pg: Pick<PGlite, "query">, userId: string, host: string): Promise<string[]> {
  const attributed = await pg.query<{ id: string; oauth_client_id: string }>(
    `SELECT id, oauth_client_id FROM mcp_connections
     WHERE user_id = $1 AND revoked_at IS NULL AND host = $2`,
    [userId, host],
  );
  // A legacy `host IS NULL` row is claimed only when the provider has no row of its
  // own: pre-attribution connections must stay disconnectable, but a provider that
  // DID attribute can never revoke another assistant's row.
  const targets =
    attributed.rows.length > 0
      ? attributed.rows
      : (
          await pg.query<{ id: string; oauth_client_id: string }>(
            `SELECT id, oauth_client_id FROM mcp_connections
             WHERE user_id = $1 AND revoked_at IS NULL AND host IS NULL`,
            [userId],
          )
        ).rows;
  if (targets.length === 0) return [];
  await pg.query(`UPDATE mcp_connections SET revoked_at = NOW() WHERE id = ANY($1)`, [
    targets.map((row) => row.id),
  ]);
  return targets.map((row) => row.oauth_client_id);
}

/** A provider's self-report: refresh its own row, or claim the unattributed one. */
async function announce(pg: PGlite, userId: string, host: string): Promise<number> {
  const refreshed = await pg.query(
    `UPDATE mcp_connections SET last_active_at = NOW(), revoked_at = NULL
     WHERE user_id = $1 AND revoked_at IS NULL AND host = $2`,
    [userId, host],
  );
  if ((refreshed.affectedRows ?? 0) > 0) return refreshed.affectedRows ?? 0;

  const candidate = await pg.query<{ id: string }>(
    `SELECT id FROM mcp_connections
     WHERE user_id = $1 AND revoked_at IS NULL AND host IS NULL
     ORDER BY last_active_at DESC LIMIT 1`,
    [userId],
  );
  const id = candidate.rows[0]?.id;
  if (!id) return 0;
  await pg.query(
    `UPDATE mcp_connections SET host = $1, last_active_at = NOW(), revoked_at = NULL
     WHERE id = $2`,
    [host, id],
  );
  return 1;
}


/** Check the grant and write liveness together, so delayed recording stays dead. */
async function recordActivity(
  pg: PGlite,
  input: Parameters<McpConnectionStore["recordActivity"]>[0],
): Promise<void> {
  await pg.transaction(async (tx) => {
    if (input.refreshTokenHash) {
      const { rows } = await tx.query<{ token_hash: string }>(
        `SELECT token_hash FROM oauth_refresh_tokens WHERE token_hash = $1
         AND client_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
        [input.refreshTokenHash, input.oauthClientId, input.at],
      );
      if (rows.length !== 1) return;
    }
    const { userId, oauthClientId, clientName, host, at } = input;
    await tx.query(
      `INSERT INTO mcp_connections
         (id, user_id, oauth_client_id, client_name, host, connected_at, last_active_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $5)
       ON CONFLICT (user_id, oauth_client_id) DO UPDATE SET
         client_name = EXCLUDED.client_name,
         last_active_at = EXCLUDED.last_active_at,
         revoked_at = NULL,
         host = COALESCE(EXCLUDED.host, mcp_connections.host)`,
      [userId, oauthClientId, clientName, host, at],
    );
  });
}
