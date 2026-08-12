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
    update(args: {
      where: { tokenHash: string };
      data: { revokedAt: Date };
    }): Promise<unknown>;
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
  /** Prisma's own transaction, used for the rotation's two writes. */
  $transaction<T>(operations: Promise<T>[]): Promise<T[]>;
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
      // Both writes or neither: a crash between them leaves a live parent AND a
      // live child, i.e. two usable tokens where rotation promises one.
      await prisma.$transaction([
        prisma.oAuthRefreshToken.create({ data: successor }) as Promise<unknown>,
        prisma.oAuthRefreshToken.update({
          where: { tokenHash: parentHash },
          data: { revokedAt: at },
        }) as Promise<unknown>,
      ]);
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
