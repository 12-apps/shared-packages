import { generateKeyPair, exportPKCS8 } from "jose";

import { createApiMcpOauth, type ApiMcpOauth } from "../create-api-mcp-oauth";
import { computeChallenge } from "../pkce";
import { signingKeyProvider, type McpSigningKeyProvider } from "../keys";
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
} from "../stores";
import type { McpOauthSession } from "../context";

/**
 * A FIXED clock for the in-memory stores.
 *
 * `new Date()` in a fixture is a value that changes between runs for no reason
 * the test cares about — and the flakiness gate is right to call it out. The
 * ordering these stores need (most-recently-active first) is expressed by
 * `tick()`, which is monotonic and deterministic.
 */
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const clock = { ticks: 0 };
function tick(): Date {
  clock.ticks += 1;
  return new Date(FIXED_NOW.getTime() + clock.ticks * 1000);
}

/**
 * The AS's three stores, in memory, plus a real ES256 key pair.
 *
 * The key is REAL (jose, generated once per suite) rather than stubbed: every
 * invariant these suites assert — a code that cannot be replayed as an access
 * token, an audience a resource server pins, a `kid` a verifier resolves — is a
 * property of actual signatures. A fake signer would leave all of it unexercised.
 *
 * The harness fills the same ports with SQL over a real Postgres, which is where
 * the Prisma-shape compatibility is proven; these are for the semantics.
 */

export async function testSigningKey(): Promise<McpSigningKeyProvider> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pem = await exportPKCS8(privateKey);
  return signingKeyProvider(() => ({ pem, kid: "test-key-1" }));
}

function memoryClientStore(): OAuthClientStore & { rows: () => StoredOAuthClient[] } {
  const rows = new Map<string, StoredOAuthClient>();
  return {
    rows: () => [...rows.values()],
    async create(client: NewOAuthClient) {
      const stored: StoredOAuthClient = { ...client };
      rows.set(client.clientId, stored);
      return stored;
    },
    async findByClientId(clientId) {
      return rows.get(clientId) ?? null;
    },
  };
}

function memoryRefreshTokenStore(): RefreshTokenStore & {
  rows: () => StoredRefreshToken[];
} {
  const rows = new Map<string, StoredRefreshToken>();
  const put = (token: NewRefreshToken): void => {
    rows.set(token.tokenHash, { ...token, revokedAt: null });
  };
  return {
    rows: () => [...rows.values()],
    async create(token) {
      put(token);
    },
    async findByHash(tokenHash) {
      return rows.get(tokenHash) ?? null;
    },
    async hasSuccessor(tokenHash) {
      return [...rows.values()].some((row) => row.rotatedFrom === tokenHash);
    },
    async listFamily(userEmail, clientId) {
      return [...rows.values()].filter(
        (row) => row.userEmail === userEmail && row.clientId === clientId,
      );
    },
    async revokeHashes(tokenHashes, at) {
      for (const hash of tokenHashes) {
        const row = rows.get(hash);
        if (row) rows.set(hash, { ...row, revokedAt: at });
      }
    },
    async rotate(successor, parentHash, at) {
      put(successor);
      const parent = rows.get(parentHash);
      if (parent) rows.set(parentHash, { ...parent, revokedAt: at });
    },
    async revokeLiveForClient(userEmail, clientId) {
      // A container's property rather than a closed-over binding: the same reason
      // the repo's flakiness rule asks for it, and it reads no worse.
      const revoked = { count: 0 };
      for (const [hash, row] of rows) {
        if (row.userEmail === userEmail && row.clientId === clientId && !row.revokedAt) {
          rows.set(hash, { ...row, revokedAt: tick() });
          revoked.count += 1;
        }
      }
      return revoked.count;
    },
  };
}

interface ConnectionRow extends StoredMcpConnection {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

function memoryConnectionStore(): McpConnectionStore & { rows: () => ConnectionRow[] } {
  const rows: ConnectionRow[] = [];
  const find = (userId: string, oauthClientId: string): ConnectionRow | undefined =>
    rows.find((row) => row.userId === userId && row.oauthClientId === oauthClientId);
  return {
    rows: () => rows.map((row) => ({ ...row })),
    async lastActiveAt(userId, oauthClientId) {
      return find(userId, oauthClientId)?.lastActiveAt ?? null;
    },
    async recordActivity({ userId, oauthClientId, clientName, host, at }) {
      const existing = find(userId, oauthClientId);
      if (existing) {
        existing.clientName = clientName;
        existing.lastActiveAt = at;
        existing.revokedAt = null;
        if (host) existing.host = host;
        return;
      }
      rows.push({
        id: `conn-${rows.length + 1}`,
        userId,
        oauthClientId,
        clientName,
        host,
        connectedAt: at,
        lastActiveAt: at,
        revokedAt: null,
      });
    },
    async listActive(userId) {
      return rows
        .filter((row) => row.userId === userId && !row.revokedAt)
        .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
    },
    async revokeByHost(userId, host) {
      const live = rows.filter((row) => row.userId === userId && !row.revokedAt);
      const attributed = live.filter((row) => row.host === host);
      const targets = attributed.length > 0 ? attributed : live.filter((row) => row.host === null);
      for (const row of targets) row.revokedAt = tick();
      return targets.map((row) => row.oauthClientId);
    },
    async announce(userId, host) {
      const live = rows.filter((row) => row.userId === userId && !row.revokedAt);
      const attributed = live.filter((row) => row.host === host);
      if (attributed.length > 0) {
        for (const row of attributed) row.lastActiveAt = tick();
        return attributed.length;
      }
      const candidate = live
        .filter((row) => row.host === null)
        .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())[0];
      if (!candidate) return 0;
      candidate.host = host;
      candidate.lastActiveAt = tick();
      return 1;
    },
  };
}

interface AsHarness {
  api: ApiMcpOauth;
  stores: McpOauthStores & {
    clients: ReturnType<typeof memoryClientStore>;
    refreshTokens: ReturnType<typeof memoryRefreshTokenStore>;
    connections: ReturnType<typeof memoryConnectionStore>;
  };
  /** The session the authorize endpoint resolves; mutate to sign in/out. */
  session: { current: McpOauthSession | null };
}

export async function asHarness(
  overrides: Partial<Parameters<typeof createApiMcpOauth>[0]> = {},
): Promise<AsHarness> {
  const stores = {
    clients: memoryClientStore(),
    refreshTokens: memoryRefreshTokenStore(),
    connections: memoryConnectionStore(),
  };
  const session: { current: McpOauthSession | null } = {
    current: { subject: "google-sub-1", email: "owner@example.com" },
  };
  const api = createApiMcpOauth({
    stores,
    resolveSession: () => session.current,
    signingKey: await testSigningKey(),
    connections: { resolveUserId: (email) => (email ? "user-1" : null) },
    ...overrides,
  });
  return { api, stores, session };
}

/** Register a client the way a connector does, through the real endpoint. */
export async function registerTestClient(
  api: ApiMcpOauth,
  metadata: Record<string, unknown> = {},
): Promise<{ clientId: string; clientSecret?: string }> {
  const response = await api.handlers.register(
    new Request("https://app.example.com/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        client_name: "Claude",
        ...metadata,
      }),
    }),
  );
  const body = (await response.json()) as { client_id: string; client_secret?: string };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

/** A PKCE pair: the verifier to present, and the S256 challenge to bind. */
export async function pkcePair(verifier = "verifier-".padEnd(64, "x")): Promise<{
  verifier: string;
  challenge: string;
}> {
  return { verifier, challenge: await computeChallenge(verifier) };
}

/** Drive `GET /authorize` and return the `Location` it redirects to. */
export async function authorize(
  api: ApiMcpOauth,
  params: Record<string, string>,
): Promise<Response> {
  const url = new URL("https://app.example.com/api/oauth/authorize");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return api.handlers.authorize(new Request(url.toString()));
}

/** Drive `POST /token` with a form body, as an OAuth client does. */
export async function token(
  api: ApiMcpOauth,
  form: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return api.handlers.token(
    new Request("https://app.example.com/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

/** The `code` query parameter of an authorize redirect. */
export function codeFrom(response: Response): string {
  const location = response.headers.get("location");
  if (!location) throw new Error("no Location header on the authorize response");
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`no code in ${location}`);
  return code;
}
