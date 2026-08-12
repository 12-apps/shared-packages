/**
 * The persistence PORTS of the authorization server (12-23).
 *
 * Three tables back the AS, and the package owns all three (see
 * `prisma/mcp.prisma`): registered clients, rotating refresh tokens, and the
 * per-user record of which AI host is live. What the package does NOT own is the
 * client library used to reach them — so every read and write in the surface goes
 * through these narrow ports, and `createPrismaMcpStores` (in
 * `./prisma-stores.ts`) fills them for the common case in one line.
 *
 * The shapes are deliberately CLOSED and small: a host on something other than
 * Prisma has a finite surface to fill, and the harness fills exactly this with
 * hand-written SQL over a real Postgres.
 */

/** The two token-endpoint auth methods the AS accepts (matches the DB CHECK). */
export type TokenEndpointAuthMethod = "none" | "client_secret_basic";

/** A registered OAuth client (an external host app — Claude.ai, ChatGPT…). */
export interface StoredOAuthClient {
  clientId: string;
  /** SHA-256 hex of the secret; `null` for a public PKCE client. */
  clientSecretHash: string | null;
  /** The EXACT-MATCH allowlist the authorize endpoint validates against. */
  redirectUris: string[];
  clientName: string | null;
  tokenEndpointAuthMethod: string;
  grantTypes: string[];
  scopes: string[];
}

/** What `register` persists (the durable subset of RFC 7591 metadata). */
export interface NewOAuthClient {
  clientId: string;
  clientSecretHash: string | null;
  redirectUris: string[];
  clientName: string | null;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  grantTypes: string[];
  scopes: string[];
}

export interface OAuthClientStore {
  create(client: NewOAuthClient): Promise<StoredOAuthClient>;
  /** By the PUBLIC `client_id`, or `null` when unknown. */
  findByClientId(clientId: string): Promise<StoredOAuthClient | null>;
}

/** A rotating refresh token, stored HASHED — never plaintext. */
export interface StoredRefreshToken {
  tokenHash: string;
  userEmail: string;
  /** The original OAuth subject, kept stable across every rotation. */
  userSub: string;
  clientId: string;
  scopes: string[];
  expiresAt: Date;
  /** The prior token's hash — the rotation lineage. `null` for a root token. */
  rotatedFrom: string | null;
  revokedAt: Date | null;
}

/** A token about to be stored (the plaintext never is). */
export type NewRefreshToken = Omit<StoredRefreshToken, "revokedAt">;

export interface RefreshTokenStore {
  create(token: NewRefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;
  /** Whether some token was already rotated FROM this hash (replay detection). */
  hasSuccessor(tokenHash: string): Promise<boolean>;
  /** Every token of one `(userEmail, clientId)` family — the lineage walk's input. */
  listFamily(userEmail: string, clientId: string): Promise<StoredRefreshToken[]>;
  /** Revoke exactly these hashes (idempotent). */
  revokeHashes(tokenHashes: readonly string[], at: Date): Promise<void>;
  /**
   * Store the successor AND revoke its parent ATOMICALLY. A crash between the
   * two would leave a live parent and a live child — two usable tokens where the
   * rotation contract promises one.
   */
  rotate(successor: NewRefreshToken, parentHash: string, at: Date): Promise<void>;
  /**
   * Revoke every LIVE token a user holds for one client; returns how many were
   * actually ended (already-revoked rows are skipped, so a repeat reports 0).
   */
  revokeLiveForClient(userEmail: string, clientId: string): Promise<number>;
}

/** The AI provider a connection is attributed to. */
export type McpConnectionHost = string;

/** A live connection, as the account surface shows it. */
export interface StoredMcpConnection {
  oauthClientId: string;
  clientName: string | null;
  /** `null` for a pre-attribution connection. */
  host: string | null;
  connectedAt: Date;
  lastActiveAt: Date;
}

export interface McpConnectionStore {
  /** Liveness of one `(user, client)` pair, for the activity throttle. */
  lastActiveAt(userId: string, oauthClientId: string): Promise<Date | null>;
  /**
   * Record (or refresh) liveness. Any activity CLEARS a prior `revokedAt` — the
   * host is talking to us again — and must never blank a known `host` when this
   * grant cannot derive one.
   */
  recordActivity(input: {
    userId: string;
    oauthClientId: string;
    clientName: string | null;
    host: string | null;
    at: Date;
  }): Promise<void>;
  /** A user's active (non-revoked) connections, most-recently-active first. */
  listActive(userId: string): Promise<StoredMcpConnection[]>;
  /**
   * Revoke every live connection of one provider for this user and return the
   * OAuth client ids that were revoked — the caller ends their refresh tokens,
   * which is what actually cuts access.
   */
  revokeByHost(userId: string, host: McpConnectionHost): Promise<string[]>;
  /**
   * The self-report path: attribute this user's just-connected, still-unattributed
   * connection to `host`, or refresh the one already attributed to it. Returns
   * rows touched.
   */
  announce(userId: string, host: McpConnectionHost): Promise<number>;
}

/** The stores the AS needs. `connections` is optional — see the config docs. */
export interface McpOauthStores {
  clients: OAuthClientStore;
  refreshTokens: RefreshTokenStore;
  connections?: McpConnectionStore;
}
