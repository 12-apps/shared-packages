/**
 * The three `@12-apps/mcp/oauth` stores, backed by a REAL Postgres (12-23).
 *
 * The ports are narrow and CLOSED by design (`src/oauth/stores.ts`), which is what
 * lets a non-Prisma host — this harness — fill them with hand-written SQL over the
 * PACKAGE'S OWN tables, created by its own migration out of the installed tarball.
 * A real host passes `createPrismaMcpStores(...)` instead, and the AS cannot tell
 * the difference: that indistinguishability IS the seam's claim.
 *
 * Nothing here stores a plaintext token or secret, because nothing here is ever
 * given one — the package hashes before it reaches a port, which is the property
 * `mcp-oauth.test.ts` asserts against these very rows.
 */
import type { PGlite } from '@electric-sql/pglite';
import type {
  McpConnectionStore,
  McpOauthStores,
  NewOAuthClient,
  NewRefreshToken,
  OAuthClientStore,
  RefreshTokenStore,
  StoredMcpConnection,
  StoredOAuthClient,
  StoredRefreshToken,
} from '@12-apps/mcp/oauth';

interface ClientRaw {
  client_id: string;
  client_secret_hash: string | null;
  redirect_uris: string[];
  client_name: string | null;
  token_endpoint_auth_method: string;
  grant_types: string[];
  scopes: string[];
}

function toClient(raw: ClientRaw): StoredOAuthClient {
  return {
    clientId: raw.client_id,
    clientSecretHash: raw.client_secret_hash,
    redirectUris: raw.redirect_uris,
    clientName: raw.client_name,
    tokenEndpointAuthMethod: raw.token_endpoint_auth_method,
    grantTypes: raw.grant_types,
    scopes: raw.scopes,
  };
}

const CLIENT_COLUMNS =
  'client_id, client_secret_hash, redirect_uris, client_name, token_endpoint_auth_method, grant_types, scopes';

function clientStore(pg: PGlite): OAuthClientStore {
  return {
    async create(client: NewOAuthClient) {
      await pg.query(
        `INSERT INTO oauth_clients
           (id, client_id, client_secret_hash, redirect_uris, client_name,
            token_endpoint_auth_method, grant_types, scopes, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          client.clientId,
          client.clientSecretHash,
          client.redirectUris,
          client.clientName,
          client.tokenEndpointAuthMethod,
          client.grantTypes,
          client.scopes,
        ],
      );
      return { ...client };
    },
    async findByClientId(clientId) {
      const { rows } = await pg.query<ClientRaw>(
        `SELECT ${CLIENT_COLUMNS} FROM oauth_clients WHERE client_id = $1`,
        [clientId],
      );
      return rows[0] ? toClient(rows[0]) : null;
    },
  };
}

interface TokenRaw {
  token_hash: string;
  user_email: string;
  user_sub: string;
  client_id: string;
  scopes: string[];
  expires_at: Date;
  rotated_from: string | null;
  revoked_at: Date | null;
}

function toToken(raw: TokenRaw): StoredRefreshToken {
  return {
    tokenHash: raw.token_hash,
    userEmail: raw.user_email,
    userSub: raw.user_sub,
    clientId: raw.client_id,
    scopes: raw.scopes,
    expiresAt: new Date(raw.expires_at),
    rotatedFrom: raw.rotated_from,
    revokedAt: raw.revoked_at ? new Date(raw.revoked_at) : null,
  };
}

const TOKEN_COLUMNS =
  'token_hash, user_email, user_sub, client_id, scopes, expires_at, rotated_from, revoked_at';

async function insertToken(pg: PGlite, token: NewRefreshToken): Promise<void> {
  await pg.query(
    `INSERT INTO oauth_refresh_tokens
       (id, token_hash, user_email, user_sub, client_id, scopes, expires_at, rotated_from, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      token.tokenHash,
      token.userEmail,
      token.userSub,
      token.clientId,
      token.scopes,
      token.expiresAt,
      token.rotatedFrom,
    ],
  );
}

function refreshTokenStore(pg: PGlite): RefreshTokenStore {
  return {
    create: (token) => insertToken(pg, token),

    async findByHash(tokenHash) {
      const { rows } = await pg.query<TokenRaw>(
        `SELECT ${TOKEN_COLUMNS} FROM oauth_refresh_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      return rows[0] ? toToken(rows[0]) : null;
    },

    async hasSuccessor(tokenHash) {
      const { rows } = await pg.query<{ one: number }>(
        `SELECT 1 AS one FROM oauth_refresh_tokens WHERE rotated_from = $1 LIMIT 1`,
        [tokenHash],
      );
      return rows.length > 0;
    },

    async listFamily(userEmail, clientId) {
      const { rows } = await pg.query<TokenRaw>(
        `SELECT ${TOKEN_COLUMNS} FROM oauth_refresh_tokens
         WHERE user_email = $1 AND client_id = $2`,
        [userEmail, clientId],
      );
      return rows.map(toToken);
    },

    async revokeHashes(tokenHashes, at) {
      if (tokenHashes.length === 0) return;
      await pg.query(
        `UPDATE oauth_refresh_tokens SET revoked_at = $1 WHERE token_hash = ANY($2)`,
        [at, [...tokenHashes]],
      );
    },

    async rotate(successor, parentHash, at) {
      // The port's CLAIM-ONCE contract, in SQL rather than Prisma — a non-Prisma
      // host satisfying the same requirement by hand, which is why the harness
      // fills these ports itself. The parent revoke is CONDITIONAL on the row still
      // being live, and the successor is inserted only when that claim took effect;
      // one transaction covers the crash case as before.
      return pg.transaction(async (tx) => {
        const claim = await tx.query(
          `UPDATE oauth_refresh_tokens SET revoked_at = $1
             WHERE token_hash = $2 AND revoked_at IS NULL`,
          [at, parentHash],
        );
        // Lost the claim (a concurrent rotation got there, or the parent was already
        // revoked): write NOTHING and say so.
        if ((claim.affectedRows ?? 0) !== 1) return false;
        await tx.query(
          `INSERT INTO oauth_refresh_tokens
             (id, token_hash, user_email, user_sub, client_id, scopes, expires_at, rotated_from, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            successor.tokenHash,
            successor.userEmail,
            successor.userSub,
            successor.clientId,
            successor.scopes,
            successor.expiresAt,
            successor.rotatedFrom,
          ],
        );
        return true;
      });
    },

    async revokeLiveForClient(userEmail, clientId) {
      const result = await pg.query(
        `UPDATE oauth_refresh_tokens SET revoked_at = NOW()
         WHERE user_email = $1 AND client_id = $2 AND revoked_at IS NULL`,
        [userEmail, clientId],
      );
      return result.affectedRows ?? 0;
    },
  };
}

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

function connectionStore(pg: PGlite): McpConnectionStore {
  return {
    async lastActiveAt(userId, oauthClientId) {
      const { rows } = await pg.query<{ last_active_at: Date }>(
        `SELECT last_active_at FROM mcp_connections
         WHERE user_id = $1 AND oauth_client_id = $2`,
        [userId, oauthClientId],
      );
      return rows[0] ? new Date(rows[0].last_active_at) : null;
    },

    async recordActivity({ userId, oauthClientId, clientName, host, at }) {
      // COALESCE on host: never blank a known attribution when this grant cannot
      // derive one — the config page would lose the card it just lit.
      await pg.query(
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
    },

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
async function revokeByHost(pg: PGlite, userId: string, host: string): Promise<string[]> {
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

/** The ports a real host fills with Prisma, filled here with SQL over PGlite. */
export function mcpOauthDb(pg: PGlite): McpOauthStores {
  return {
    clients: clientStore(pg),
    refreshTokens: refreshTokenStore(pg),
    connections: connectionStore(pg),
  };
}
