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
  /**
   * This token's own plaintext, SEALED under a key derived from the plaintext of
   * the token it was rotated from (`./rotation-grace.ts`), and readable only by a
   * caller presenting that parent.
   *
   * It is what lets a rotation be retried: within the grace window, re-presenting
   * the consumed parent returns THIS successor again instead of destroying the
   * lineage, so a lost response or two concurrent refreshes no longer force the
   * user through the whole authorization flow again.
   *
   * REQUIRED of a store from this version on, even though the type is optional
   * for the root token that has no parent to seal under. `rotate` writes it on
   * every successor and CLEARS it on every parent it consumes.
   *
   * A PRISMA host that raises the version without the column fails loudly, on
   * every rotation, because the delegate rejects the unknown key — a dead token
   * endpoint rather than a degraded one, and the reason to land the migration in
   * the SAME change as the version raise. A hand-written store has no such
   * backstop: drop the field there and the window silently never applies, so
   * implementing this field and its clearing is part of meeting the port, not an
   * optional extra. `harness/backend/src/mcp-oauth-db.ts` is the worked example.
   *
   * Clearing it on consumption is what bounds the exposure, and it is the whole
   * reason the field is safe to store at all: a seal is openable only by the
   * plaintext of the token it was rotated from, so leaving spent seals in place
   * would let anyone holding ONE historical plaintext plus a copy of this table
   * walk the chain forward offline — hop by hop, with no server call and so no
   * replay detection — all the way to the live token. With the parent's seal
   * cleared as it is consumed, at most one hop is ever open, and only while the
   * successor it points at is still the live token.
   */
  graceSeal?: string | null;
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
  /**
   * Revoke exactly these hashes (idempotent), CLEARING each row's `graceSeal`.
   *
   * A revoked lineage must leave nothing openable behind it — otherwise the
   * revocation that replay detection exists to perform would still leave the
   * chain readable to anyone holding one of its plaintexts.
   */
  revokeHashes(tokenHashes: readonly string[], at: Date): Promise<void>;
  /**
   * CLAIM the parent and store the successor, atomically. The whole of OAuth 2.1
   * §4.3.1 replay protection rests on this one method, so read the contract before
   * implementing it.
   *
   * Returns `true` when THIS call is the one that consumed `parentHash`, `false`
   * when another call already had. `false` MUST mean nothing was written: no
   * successor row, no second revocation.
   *
   * An implementation MUST revoke the parent CONDITIONALLY on it still being
   * unrevoked — `updateMany({ where: { tokenHash: parentHash, revokedAt: null } })`,
   * requiring a count of exactly 1 — and create the successor in the SAME
   * transaction. An unconditional `update` is NOT enough: two concurrent rotations
   * of one parent would both succeed, leaving two live successors of one token with
   * no replay ever detected, because the replay rule fires on a THIRD use of the
   * parent that then never comes. That is replay protection defeated by WINNING a
   * race rather than by arriving second — precisely the attack rotation exists to
   * stop, since an attacker holding a stolen refresh token need only fire it
   * alongside the legitimate client to walk away with a live, independently
   * rotating family.
   *
   * Atomicity against a CRASH is necessary too (a half-applied rotation leaves a
   * live parent AND a live child) but it is not sufficient, and it is the easier
   * half to satisfy by accident.
   */
  /**
   * The claim MUST also clear the parent's own `graceSeal`. It is not tidiness:
   * an uncleared seal is permanently openable by the plaintext it was sealed
   * under, so a chain of them is an offline path from any historical token to
   * the live one. Clearing on consumption keeps at most one hop readable.
   */
  rotate(successor: NewRefreshToken, parentHash: string, at: Date): Promise<boolean>;
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
