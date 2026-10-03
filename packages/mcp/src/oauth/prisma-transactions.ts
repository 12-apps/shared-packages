import type { McpOauthPrismaProvider, McpOauthTx } from "./prisma-stores";
import type { McpConnectionStore, NewRefreshToken } from "./stores";
import { lineageHashes } from "./refresh-lineage";

/** Read/write conflicts retry the ENTIRE operation against a fresh snapshot.
 * Exhaustion throws: a failed disconnect is never reported as successful. */
async function serializable<T>(
  getPrisma: McpOauthPrismaProvider,
  operation: (tx: McpOauthTx) => Promise<T>,
): Promise<T> {
  const prisma = await getPrisma();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = typeof error === "object" && error !== null &&
        "code" in error && error.code === "P2034";
      if (!retryable || attempt >= 2) throw error;
    }
  }
}

export async function rotateClaim(
  getPrisma: McpOauthPrismaProvider,
  successor: NewRefreshToken,
  parentHash: string,
  at: Date,
): Promise<boolean> {
  return serializable(getPrisma, async (tx) => {
    const { count } = await tx.oAuthRefreshToken.updateMany({
      where: { tokenHash: parentHash, revokedAt: null },
      data: { revokedAt: at, graceSeal: null },
    });
    if (count !== 1) return false;
    await tx.oAuthRefreshToken.create({ data: successor });
    return true;
  });
}

export async function revokeLive(
  getPrisma: McpOauthPrismaProvider,
  userEmail: string,
  clientId: string,
): Promise<number> {
  return serializable(getPrisma, async (tx) => {
    const { count } = await tx.oAuthRefreshToken.updateMany({
      where: { userEmail, clientId, revokedAt: null },
      data: { revokedAt: new Date(), graceSeal: null },
    });
    return count;
  });
}

export async function revokeAtomicLineage(
  getPrisma: McpOauthPrismaProvider,
  scope: { userEmail: string; clientId: string },
  seed: string,
  at: Date,
): Promise<void> {
  await serializable(getPrisma, async (tx) => {
    const rows = await tx.oAuthRefreshToken.findMany({
      where: { userEmail: scope.userEmail, clientId: scope.clientId },
    });
    await tx.oAuthRefreshToken.updateMany({
      where: { tokenHash: { in: lineageHashes(rows, seed) } },
      data: { revokedAt: at, graceSeal: null },
    });
  });
}

/** Both halves commit together and serialize against rotation and replay. */
export async function disconnectAtomic(
  getPrisma: McpOauthPrismaProvider,
  userId: string,
  email: string,
  host: string,
): Promise<{ disconnectedClientIds: string[]; revokedRefreshTokens: number }> {
  return serializable(getPrisma, async (tx) => {
    const attributed = await tx.mcpConnection.findMany({
      where: { userId, revokedAt: null, host },
      select: { id: true, oauthClientId: true },
    });
    const targets = attributed.length > 0 ? attributed : await tx.mcpConnection.findMany({
      where: { userId, revokedAt: null, host: null },
      select: { id: true, oauthClientId: true },
    });
    const disconnectedClientIds = targets.map((row) => String(row.oauthClientId));
    if (targets.length === 0) return { disconnectedClientIds, revokedRefreshTokens: 0 };
    const at = new Date();
    const revoked = await tx.oAuthRefreshToken.updateMany({
      where: { userEmail: email, clientId: { in: disconnectedClientIds }, revokedAt: null },
      data: { revokedAt: at, graceSeal: null },
    });
    await tx.mcpConnection.updateMany({
      where: { id: { in: targets.map((row) => String(row.id)) } },
      data: { revokedAt: at },
    });
    return { disconnectedClientIds, revokedRefreshTokens: revoked.count };
  });
}

/** Stale grant recording cannot undo a completed disconnect's visible state. */
export async function recordConnectionActivity(
  getPrisma: McpOauthPrismaProvider,
  input: Parameters<McpConnectionStore["recordActivity"]>[0],
): Promise<void> {
  await serializable(getPrisma, async (tx) => {
    if (input.refreshTokenHash) {
      const token = await tx.oAuthRefreshToken.findUnique({ where: { tokenHash: input.refreshTokenHash } });
      if (!token || token.revokedAt !== null || token.clientId !== input.oauthClientId ||
        token.expiresAt.getTime() <= input.at.getTime()) return;
    }
    const { userId, oauthClientId, clientName, host, at } = input;
    await tx.mcpConnection.upsert({
      where: { userId_oauthClientId: { userId, oauthClientId } },
      create: { userId, oauthClientId, clientName, host, connectedAt: at, lastActiveAt: at },
      update: { clientName, lastActiveAt: at, revokedAt: null, ...(host ? { host } : {}) },
    });
  });
}
