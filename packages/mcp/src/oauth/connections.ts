import { providerForHostId, type AiProvider } from "../guide";
import type {
  McpConnectionStore,
  RefreshTokenStore,
  StoredMcpConnection,
} from "./stores";

/**
 * The account surface's connection OPERATIONS (12-48) — the half of the
 * `GET/DELETE /api/account/mcp-connections` endpoints that is contract rather
 * than host vocabulary.
 *
 * The ROUTE stays in the host on purpose: it mixes the host's session
 * resolution, its response envelope, its published plugin URLs and its logger,
 * and injecting all four here would make the config surface bigger than the
 * handler it replaces. What must NOT stay in each host is the disconnect's
 * both-halves rule, because getting it half right LOOKS right:
 *
 * `connections.revokeByHost` ends the connection rows and returns the OAuth
 * client ids behind them — and a host that stops there has revoked nothing that
 * matters. The assistant still holds a live refresh token for each of those
 * clients, rotates it on schedule, and the very next grant records fresh
 * activity: the card the user just disconnected lights green again on its own.
 * So the rule is one function: revoke the rows AND end every live refresh token
 * of each returned client, in the same call, with no way to import one half
 * without the other.
 *
 * Deliberately NOT invalidated here: the assistant's current ACCESS token.
 * Those are self-contained JWTs the server does not track; a just-disconnected
 * host keeps working for at most their TTL (15 minutes by default) and can then
 * obtain nothing further.
 */

/** An active AI connection, narrowed for display. */
export interface AiConnectionSnapshot {
  oauthClientId: string;
  clientName: string | null;
  /** The provider this connection is attributed to (`null` = pre-attribution). */
  host: AiProvider | null;
  connectedAt: Date;
  lastActiveAt: Date;
}

/** The caller the operations act for — always the session's own user. */
export interface AiConnectionCaller {
  /** The host's user id — what `mcp_connections` rows are keyed by. */
  userId: string;
  /** The identity refresh tokens are bound to (the AS binds by email). */
  email: string;
}

/** What one disconnect actually ended, for the host's log and response. */
export interface AiDisconnectResult {
  /** OAuth client ids whose connection rows were revoked. */
  disconnectedClientIds: string[];
  /** Live refresh tokens ended across those clients — the half that cuts access. */
  revokedRefreshTokens: number;
}

/** Narrow a stored `host` string to a known provider, or `null`. */
function asProvider(host: string | null): AiProvider | null {
  return host === null ? null : providerForHostId(host);
}

/**
 * A user's active connections, most-recently-active first, with the stored open
 * `host` string narrowed to the package's closed {@link AiProvider} union — the
 * store cannot know which assistants have screens, but the union is this
 * package's own vocabulary (`guide.ts`), so the narrowing lives beside it
 * rather than being re-derived in every host.
 */
export async function listAiConnections(
  connections: McpConnectionStore,
  userId: string,
): Promise<AiConnectionSnapshot[]> {
  const rows: StoredMcpConnection[] = await connections.listActive(userId);
  return rows.map((row) => ({ ...row, host: asProvider(row.host) }));
}

/**
 * Disconnect one provider for this user — BOTH halves, atomically from the
 * caller's point of view (see the module doc for why one half alone is a
 * disconnect that undoes itself).
 *
 * Idempotent: disconnecting a provider that was never connected returns zero
 * counts rather than failing, so a double-click is harmless. Repeat calls also
 * report zero — `revokeLiveForClient` skips already-revoked tokens by contract.
 */
export async function disconnectAiHost(
  stores: { connections: McpConnectionStore; refreshTokens: RefreshTokenStore },
  caller: AiConnectionCaller,
  host: AiProvider,
): Promise<AiDisconnectResult> {
  const disconnectedClientIds = await stores.connections.revokeByHost(caller.userId, host);
  const revoked = await Promise.all(
    disconnectedClientIds.map((clientId) =>
      stores.refreshTokens.revokeLiveForClient(caller.email, clientId),
    ),
  );
  return {
    disconnectedClientIds,
    revokedRefreshTokens: revoked.reduce((total, count) => total + count, 0),
  };
}
