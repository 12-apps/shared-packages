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
} from "./stores";

/**
 * The ports of `./stores.ts`, filled by Prisma (12-23).
 *
 * The package owns the three models (`prisma/mcp.prisma`), so their delegate
 * shapes are known and this adapter can be exact. A host with Prisma therefore
 * writes ONE line —
 *
 *   stores: createPrismaMcpStores(async () => getPrismaClient() as unknown as McpOauthPrisma)
 *
 * — and no host code at all beyond it. The client is duck-typed (only the
 * delegates used, only the arguments used) so this file never imports a project's
 * generated client, and a non-Prisma host fills the ports directly instead.
 */

/** A `where` on the composite unique of `mcp_connections`. */
interface ConnectionKey {
  userId_oauthClientId: { userId: string; oauthClientId: string };
}

/** The minimal Prisma surface the AS needs. Every field is one the surface writes. */
export interface McpOauthPrisma {
  oAuthClient: {
    create(args: { data: NewOAuthClient }): Promise<StoredOAuthClient>;
    findUnique(args: { where: { clientId: string } }): Promise<StoredOAuthClient | null>;
  };
  oAuthRefreshToken: {
    create(args: { data: NewRefreshToken }): Promise<unknown>;
    findUnique(args: { where: { tokenHash: string } }): Promise<StoredRefreshToken | null>;
    findFirst(args: { where: { rotatedFrom: string } }): Promise<{ tokenHash: string } | null>;
    findMany(args: {
      where: { userEmail: string; clientId: string };
    }): Promise<StoredRefreshToken[]>;
    // No single-row `update`: the rotation used to revoke its parent with one and
    // that was the bug (unconditional, so two concurrent rotations both won). Every
    // revoke here is now an `updateMany` with a predicate that says WHICH rows may
    // move, which is also why this delegate list stays honest about what is written.
    updateMany(args: {
      where:
        | { tokenHash: { in: string[] } }
        | { userEmail: string; clientId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
  mcpConnection: {
    findUnique(args: {
      where: ConnectionKey;
      select: { lastActiveAt: true };
    }): Promise<{ lastActiveAt: Date } | null>;
    findFirst(args: {
      where: { userId: string; revokedAt: null; host: null };
      orderBy: { lastActiveAt: "desc" };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findMany(args: {
      where: { userId: string; revokedAt: null; host?: string | null };
      orderBy?: { lastActiveAt: "desc" };
      select: Record<string, true>;
    }): Promise<Record<string, unknown>[]>;
    upsert(args: {
      where: ConnectionKey;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: {
      where: { id: { in: string[] } } | { userId: string; revokedAt: null; host: string };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  /**
   * Prisma's INTERACTIVE transaction, used for the rotation's claim + write. The
   * callback form (not the array form) is required: the successor may only be
   * created once the conditional revoke has reported that it, and not a concurrent
   * sibling, claimed the parent — see `RefreshTokenStore.rotate`.
   */
  $transaction<T>(fn: (tx: McpOauthTx) => Promise<T>): Promise<T>;
}

/**
 * The delegate subset used INSIDE the rotation transaction. Not exported: it is
 * reachable structurally through `McpOauthPrisma.$transaction`, so no host ever
 * needs to name it, and exporting a type nobody imports is what knip flags.
 */
interface McpOauthTx {
  oAuthRefreshToken: {
    create(args: { data: NewRefreshToken }): Promise<unknown>;
    updateMany(args: {
      where: { tokenHash: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
}

/** A lazily-resolved client, so a host's singleton is awaited per call. */
export type McpOauthPrismaProvider = () => Promise<McpOauthPrisma>;

function clientStore(getPrisma: McpOauthPrismaProvider): OAuthClientStore {
  return {
    async create(client: NewOAuthClient) {
      const prisma = await getPrisma();
      return prisma.oAuthClient.create({ data: client });
    },
    async findByClientId(clientId: string) {
      const prisma = await getPrisma();
      return prisma.oAuthClient.findUnique({ where: { clientId } });
    },
  };
}

function refreshTokenStore(getPrisma: McpOauthPrismaProvider): RefreshTokenStore {
  return {
    async create(token) {
      const prisma = await getPrisma();
      await prisma.oAuthRefreshToken.create({ data: token });
    },
    async findByHash(tokenHash) {
      const prisma = await getPrisma();
      return prisma.oAuthRefreshToken.findUnique({ where: { tokenHash } });
    },
    async hasSuccessor(tokenHash) {
      const prisma = await getPrisma();
      const successor = await prisma.oAuthRefreshToken.findFirst({
        where: { rotatedFrom: tokenHash },
      });
      return successor !== null;
    },
    async listFamily(userEmail, clientId) {
      const prisma = await getPrisma();
      return prisma.oAuthRefreshToken.findMany({ where: { userEmail, clientId } });
    },
    async revokeHashes(tokenHashes, at) {
      if (tokenHashes.length === 0) return;
      const prisma = await getPrisma();
      await prisma.oAuthRefreshToken.updateMany({
        where: { tokenHash: { in: [...tokenHashes] } },
        data: { revokedAt: at },
      });
    },
    async rotate(successor, parentHash, at) {
      const prisma = await getPrisma();
      return prisma.$transaction(async (tx) => {
        // CLAIM-ONCE. The `revokedAt: null` predicate is what makes this safe under
        // concurrency, and it is load-bearing rather than defensive: on Postgres's
        // default READ COMMITTED, a second transaction's `updateMany` blocks on the
        // row lock, then re-evaluates this WHERE against the COMMITTED row — which
        // now has a `revokedAt` — and reports 0 rows. So exactly one caller can ever
        // see count 1, and it is the only one that goes on to create a successor.
        // An unconditional `update` would let both through: two live successors of
        // one parent, and replay detection silently defeated (it waits for a third
        // use of the parent that now never comes).
        const { count } = await tx.oAuthRefreshToken.updateMany({
          where: { tokenHash: parentHash, revokedAt: null },
          data: { revokedAt: at },
        });
        // Lost the claim: write NOTHING. The zero-row update commits as the no-op
        // it is, so there is nothing to roll back.
        if (count !== 1) return false;
        // Same transaction as the claim, so a crash cannot leave a live parent AND
        // a live child either.
        await tx.oAuthRefreshToken.create({ data: successor });
        return true;
      });
    },
    async revokeLiveForClient(userEmail, clientId) {
      const prisma = await getPrisma();
      const { count } = await prisma.oAuthRefreshToken.updateMany({
        where: { userEmail, clientId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return count;
    },
  };
}

/** The connection columns the account surface reads. */
const CONNECTION_SELECT = {
  oauthClientId: true,
  clientName: true,
  host: true,
  connectedAt: true,
  lastActiveAt: true,
} as const;

function connectionStore(getPrisma: McpOauthPrismaProvider): McpConnectionStore {
  return {
    async lastActiveAt(userId, oauthClientId) {
      const prisma = await getPrisma();
      const row = await prisma.mcpConnection.findUnique({
        where: { userId_oauthClientId: { userId, oauthClientId } },
        select: { lastActiveAt: true },
      });
      return row?.lastActiveAt ?? null;
    },
    async recordActivity({ userId, oauthClientId, clientName, host, at }) {
      const prisma = await getPrisma();
      await prisma.mcpConnection.upsert({
        where: { userId_oauthClientId: { userId, oauthClientId } },
        create: { userId, oauthClientId, clientName, host, connectedAt: at, lastActiveAt: at },
        // Never blank a known host on refresh — keep the existing attribution
        // when this grant cannot derive one.
        update: {
          clientName,
          lastActiveAt: at,
          revokedAt: null,
          ...(host ? { host } : {}),
        },
      });
    },
    async listActive(userId) {
      const prisma = await getPrisma();
      const rows = await prisma.mcpConnection.findMany({
        where: { userId, revokedAt: null },
        orderBy: { lastActiveAt: "desc" },
        select: { ...CONNECTION_SELECT },
      });
      return rows as unknown as StoredMcpConnection[];
    },
    revokeByHost: (userId, host) => revokeByHost(getPrisma, userId, host),
    announce: (userId, host) => announce(getPrisma, userId, host),
  };
}

/**
 * Disconnect one provider's connections — and ONLY that provider's.
 *
 * Every read and write is scoped by `userId`: a connection is per-user (an MCP
 * bearer is not tenant-scoped), so the user id IS the isolation here, and the
 * `id` list passed to the update comes from a query that already applied it.
 */
async function revokeByHost(
  getPrisma: McpOauthPrismaProvider,
  userId: string,
  host: string,
): Promise<string[]> {
  const prisma = await getPrisma();
  const attributed = await prisma.mcpConnection.findMany({
    where: { userId, revokedAt: null, host },
    select: { id: true, oauthClientId: true },
  });
  // A legacy `host = null` row is claimed only when the provider has no row of
  // its own: pre-attribution connections must stay disconnectable, but a provider
  // that DID attribute can never revoke another assistant's row.
  const targets =
    attributed.length > 0
      ? attributed
      : await prisma.mcpConnection.findMany({
          where: { userId, revokedAt: null, host: null },
          select: { id: true, oauthClientId: true },
        });
  if (targets.length === 0) return [];
  await prisma.mcpConnection.updateMany({
    where: { id: { in: targets.map((row) => String(row.id)) } },
    data: { revokedAt: new Date() },
  });
  return targets.map((row) => String(row.oauthClientId));
}

/** A provider's self-report: refresh its own row, or claim the unattributed one. */
async function announce(
  getPrisma: McpOauthPrismaProvider,
  userId: string,
  host: string,
): Promise<number> {
  const prisma = await getPrisma();
  const now = new Date();
  const refreshed = await prisma.mcpConnection.updateMany({
    where: { userId, revokedAt: null, host },
    data: { lastActiveAt: now, revokedAt: null },
  });
  if (refreshed.count > 0) return refreshed.count;

  // No row for this provider yet — attribute the just-connected one. Scoped by
  // user, so a self-report can never reach another account's connection.
  const candidate = await prisma.mcpConnection.findFirst({
    where: { userId, revokedAt: null, host: null },
    orderBy: { lastActiveAt: "desc" },
    select: { id: true },
  });
  if (!candidate) return 0;
  await prisma.mcpConnection.update({
    where: { id: candidate.id },
    data: { host, lastActiveAt: now, revokedAt: null },
  });
  return 1;
}

/** Every port, over one lazily-resolved Prisma client. */
export function createPrismaMcpStores(getPrisma: McpOauthPrismaProvider): McpOauthStores {
  return {
    clients: clientStore(getPrisma),
    refreshTokens: refreshTokenStore(getPrisma),
    connections: connectionStore(getPrisma),
  };
}
