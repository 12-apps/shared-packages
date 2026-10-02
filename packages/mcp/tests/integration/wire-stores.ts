// Single-process synthetic ports for the HTTP transport gate. Database atomicity
// is exercised separately by prisma-postgres.test.ts against real PostgreSQL.
export function wireStores() {
  const clients = new Map();
  const tokens = new Map();
  const connections = new Map();
  const at = new Date('2026-10-02T00:00:00Z');
  const revoke = (row, when = at) => { row.revokedAt = when; row.graceSeal = null; };
  const family = (email, clientId) => [...tokens.values()].filter(
    (row) => row.userEmail === email && row.clientId === clientId,
  );
  return {
    clients: {
      async create(row) { clients.set(row.clientId, row); return row; },
      async findByClientId(id) { return clients.get(id) ?? null; },
    },
    refreshTokens: {
      async create(row) { tokens.set(row.tokenHash, { ...row, revokedAt: null }); },
      async findByHash(hash) { return tokens.get(hash) ?? null; },
      async hasSuccessor(hash) { return [...tokens.values()].some((row) => row.rotatedFrom === hash); },
      async findSuccessor(hash) {
        const rows = [...tokens.values()].filter((row) => row.rotatedFrom === hash);
        return rows.length === 1 ? rows[0] : null;
      },
      async listFamily(email, clientId) { return family(email, clientId); },
      async revokeHashes(hashes, when) {
        for (const hash of hashes) { const row = tokens.get(hash); if (row) revoke(row, when); }
      },
      async rotate(successor, hash, when) {
        const parent = tokens.get(hash);
        if (!parent || parent.revokedAt) return false;
        revoke(parent, when);
        tokens.set(successor.tokenHash, { ...successor, revokedAt: null });
        return true;
      },
      async revokeLiveForClient(email, clientId) {
        const live = family(email, clientId).filter((row) => !row.revokedAt);
        for (const row of live) revoke(row);
        return live.length;
      },
    },
    connections: {
      async lastActiveAt(userId, clientId) {
        return connections.get(`${userId}:${clientId}`)?.lastActiveAt ?? null;
      },
      async recordActivity(row) {
        if (tokens.get(row.refreshTokenHash)?.revokedAt) return;
        connections.set(`${row.userId}:${row.oauthClientId}`, {
          ...row, connectedAt: row.at, lastActiveAt: row.at,
        });
      },
      async listActive(userId) {
        return [...connections.values()].filter((row) => row.userId === userId);
      },
      async revokeByHost(userId, host) {
        const live = [...connections.entries()].filter(([, row]) => row.userId === userId && row.host === host);
        for (const [key] of live) connections.delete(key);
        return live.map(([, row]) => row.oauthClientId);
      },
      async announce() { return 0; },
    },
  };
}
