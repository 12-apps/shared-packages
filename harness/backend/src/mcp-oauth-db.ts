import { connectionStore } from "./mcp-oauth-connections";
import { collectRefreshLineageHashes } from "@12-apps/mcp/oauth";
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
  McpOauthStores,
  NewOAuthClient,
  NewRefreshToken,
  OAuthClientStore,
  RefreshTokenStore,
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
  grace_seal: string | null;
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
    graceSeal: raw.grace_seal,
  };
}

const TOKEN_COLUMNS =
  'token_hash, user_email, user_sub, client_id, scopes, expires_at, rotated_from, revoked_at, grace_seal';

async function insertToken(pg: PGlite, token: NewRefreshToken): Promise<void> {
  await pg.query(
    `INSERT INTO oauth_refresh_tokens
       (id, token_hash, user_email, user_sub, client_id, scopes, expires_at, rotated_from, grace_seal, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      token.tokenHash,
      token.userEmail,
      token.userSub,
      token.clientId,
      token.scopes,
      token.expiresAt,
      token.rotatedFrom,
      token.graceSeal ?? null,
    ],
  );
}

/**
 * The port's CLAIM-ONCE contract, in SQL rather than Prisma — a non-Prisma host
 * satisfying the same requirement by hand, which is why the harness fills these
 * ports itself. The parent revoke is CONDITIONAL on the row still being live,
 * and the successor is inserted only when that claim took effect; one
 * transaction covers the crash case too. Clearing the parent's seal is PART of
 * the claim rather than tidying after it — see SEAL_RULE below.
 */
async function claimAndInsert(
  pg: PGlite,
  successor: NewRefreshToken,
  parentHash: string,
  at: Date,
): Promise<boolean> {
  return pg.transaction(async (tx) => {
    const claim = await tx.query(
      `UPDATE oauth_refresh_tokens SET revoked_at = $1, grace_seal = NULL
         WHERE token_hash = $2 AND revoked_at IS NULL`,
      [at, parentHash],
    );
    // Lost the claim (a concurrent rotation got there, or the parent was already
    // revoked): write NOTHING and say so.
    if ((claim.affectedRows ?? 0) !== 1) return false;
    await tx.query(
      `INSERT INTO oauth_refresh_tokens
         (id, token_hash, user_email, user_sub, client_id, scopes, expires_at, rotated_from, grace_seal, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        successor.tokenHash,
        successor.userEmail,
        successor.userSub,
        successor.clientId,
        successor.scopes,
        successor.expiresAt,
        successor.rotatedFrom,
        successor.graceSeal ?? null,
      ],
    );
    return true;
  });
}

/**
 * SEAL_RULE — why `grace_seal` is written on every insert and cleared on every
 * consume and every revoke, in all three of this store's write paths.
 *
 * A seal holds a token's own plaintext encrypted under a key derived from the
 * plaintext of the token it was rotated FROM. Left in place once its token is
 * spent, seals CHAIN: one historical plaintext plus a copy of this table walks
 * forward hop by hop to the live token, entirely offline, with no server call
 * and therefore no replay detection. Cleared as each token is consumed, at most
 * one hop is ever open. `RefreshTokenStore` in `@12-apps/mcp` states the same
 * contract; this is the raw-SQL host meeting it.
 */
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

    async findSuccessor(tokenHash) {
      const { rows } = await pg.query<TokenRaw>(
        `SELECT ${TOKEN_COLUMNS} FROM oauth_refresh_tokens WHERE rotated_from = $1 LIMIT 2`,
        [tokenHash],
      );
      return rows.length === 1 && rows[0] ? toToken(rows[0]) : null;
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
      // The seal goes with the revocation — see SEAL_RULE.
      await pg.query(
        `UPDATE oauth_refresh_tokens SET revoked_at = $1, grace_seal = NULL
         WHERE token_hash = ANY($2)`,
        [at, [...tokenHashes]],
      );
    },

    rotate: (successor, parentHash, at) => claimAndInsert(pg, successor, parentHash, at),

    async revokeLineage(scope, seed, at) {
      await pg.transaction(async (tx) => {
        const { rows } = await tx.query<TokenRaw>(
          `SELECT ${TOKEN_COLUMNS} FROM oauth_refresh_tokens WHERE user_email = $1 AND client_id = $2`,
          [scope.userEmail, scope.clientId],
        );
        const hashes = collectRefreshLineageHashes(rows.map(toToken), seed);
        await tx.query(
          `UPDATE oauth_refresh_tokens SET revoked_at = $1, grace_seal = NULL WHERE token_hash = ANY($2)`,
          [at, hashes],
        );
      });
    },

    async revokeLiveForClient(userEmail, clientId) {
      const result = await pg.query(
        `UPDATE oauth_refresh_tokens SET revoked_at = NOW(), grace_seal = NULL
         WHERE user_email = $1 AND client_id = $2 AND revoked_at IS NULL`,
        [userEmail, clientId],
      );
      return result.affectedRows ?? 0;
    },
  };
}

/** The ports a real host fills with Prisma, filled here with SQL over PGlite. */
export function mcpOauthDb(pg: PGlite): McpOauthStores {
  return {
    clients: clientStore(pg),
    refreshTokens: refreshTokenStore(pg),
    connections: connectionStore(pg),
  };
}
