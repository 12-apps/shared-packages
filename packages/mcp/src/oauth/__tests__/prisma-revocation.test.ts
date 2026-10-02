import { describe, expect, it } from "vitest";

import { createPrismaMcpStores, type McpOauthPrisma, type McpOauthTx } from "../prisma-stores";
import { disconnectAiHost } from "../connections";
import { revokeLineage } from "../refresh-lineage";
import type { NewRefreshToken, StoredRefreshToken } from "../stores";

const AT = new Date("2026-09-10T12:00:00.000Z");
const TOKEN: NewRefreshToken = {
  tokenHash: "parent", clientId: "client-one", userEmail: "owner@example.com",
  userSub: "original-sub", scopes: ["mcp:read"], rotatedFrom: null, expiresAt: AT,
};

function fakePrisma() {
  const record = {
    calls: [] as { operation: string; args: unknown }[],
    transactions: [] as unknown[],
    conflicts: 0,
    errorCode: "P2034",
    claims: 1,
    family: [{ ...TOKEN, revokedAt: AT }] as StoredRefreshToken[],
    successorRows: [] as StoredRefreshToken[],
    failAfterOperation: false,
  };
  const tx: McpOauthTx = {
    oAuthRefreshToken: {
      async findUnique(args) {
        record.calls.push({ operation: "binding", args });
        return record.family.find((row) => row.tokenHash === args.where.tokenHash) ?? null;
      },
      async create(args) { record.calls.push({ operation: "create", args }); },
      async findMany(args) {
        record.calls.push({ operation: "family", args });
        return [...record.family];
      },
      async updateMany(args) {
        record.calls.push({ operation: "revoke", args });
        return { count: record.claims };
      },
    },
    mcpConnection: {
      async upsert(args) { record.calls.push({ operation: "activity", args }); },
      async findMany(args) {
        record.calls.push({ operation: "connections", args });
        return [{ id: "connection-one", oauthClientId: "client-one" }];
      },
      async updateMany(args) {
        record.calls.push({ operation: "disconnect", args });
        return { count: 1 };
      },
    },
  };
  const prisma = {
    oAuthRefreshToken: {
      async findMany(args: unknown) {
        record.calls.push({ operation: "successor", args });
        return record.successorRows;
      },
    },
    async $transaction<T>(fn: (value: McpOauthTx) => Promise<T>, options: unknown) {
      record.transactions.push(options);
      if (record.conflicts > 0 && !record.failAfterOperation) {
        record.conflicts -= 1;
        throw Object.assign(new Error("transaction refused"), { code: record.errorCode });
      }
      const result = await fn(tx);
      if (record.conflicts > 0) {
        record.conflicts -= 1;
        // A concurrent committed rotation becomes visible only on the retry.
        if (record.family[0]) record.family[0].revokedAt = AT;
        record.family.push({ ...TOKEN, tokenHash: "child", rotatedFrom: "parent", revokedAt: null });
        throw Object.assign(new Error("concurrent write"), { code: record.errorCode });
      }
      return result;
    },
  } as unknown as McpOauthPrisma;
  return { state: record, stores: createPrismaMcpStores(async () => prisma) };
}

describe("serializable revocation adapter", () => {
  it("does not re-light a disconnected connection from delayed grant recording", async () => {
    const { state, stores } = fakePrisma();
    const activity = {
      userId: "user-one", oauthClientId: TOKEN.clientId, clientName: "Claude", host: "claude", at: AT,
      refreshTokenHash: "parent",
    };
    await stores.connections!.recordActivity(activity);
    expect(state.calls.map((call) => call.operation)).toEqual(["binding"]);
    state.family[0]!.revokedAt = null;
    state.family[0]!.expiresAt = new Date("2026-10-10T12:00:00.000Z");
    state.calls = [];
    state.conflicts = 1;
    state.failAfterOperation = true;
    await stores.connections!.recordActivity(activity);
    // The first upsert was rolled back by serialization failure; the retry sees
    // the concurrent revoke and deliberately performs no second upsert.
    expect(state.calls.map((call) => call.operation)).toEqual(["binding", "activity", "binding"]);
  });
  it("retries rotation's entire claim-and-insert transaction", async () => {
    const { state, stores } = fakePrisma();
    state.conflicts = 1;
    expect(await stores.refreshTokens.rotate({ ...TOKEN, tokenHash: "child", rotatedFrom: "parent" }, "parent", AT)).toBe(true);
    expect(state.transactions).toEqual([
      { isolationLevel: "Serializable" }, { isolationLevel: "Serializable" },
    ]);
    expect(state.calls.map((call) => call.operation)).toEqual(["revoke", "create"]);
    expect(state.calls[0]!.args).toEqual({
      where: { tokenHash: "parent", revokedAt: null }, data: { revokedAt: AT, graceSeal: null },
    });
  });

  it("does not insert a successor when another rotation/disconnect already claimed the parent", async () => {
    const { state, stores } = fakePrisma();
    state.claims = 0;
    expect(await stores.refreshTokens.rotate(TOKEN, "parent", AT)).toBe(false);
    expect(state.calls.map((call) => call.operation)).toEqual(["revoke"]);
  });

  it("disconnects both connection rows and live credentials in one serializable operation", async () => {
    const { state, stores } = fakePrisma();
    const result = await disconnectAiHost(
      { connections: stores.connections!, refreshTokens: stores.refreshTokens },
      { userId: "user-one", email: TOKEN.userEmail }, "claude",
    );
    expect(result).toEqual({ disconnectedClientIds: ["client-one"], revokedRefreshTokens: 1 });
    expect(state.transactions).toEqual([{ isolationLevel: "Serializable" }]);
    expect(state.calls.map((call) => call.operation)).toEqual(["connections", "revoke", "disconnect"]);
    expect(state.calls[1]!.args).toMatchObject({
      where: { userEmail: TOKEN.userEmail, clientId: { in: ["client-one"] }, revokedAt: null },
      data: { graceSeal: null },
    });
  });

  it("re-reads replay's whole lineage after a concurrent rotation conflict", async () => {
    const { state, stores } = fakePrisma();
    state.conflicts = 1;
    state.failAfterOperation = true;
    await revokeLineage(stores.refreshTokens, TOKEN, "parent");
    expect(state.transactions).toEqual([
      { isolationLevel: "Serializable" }, { isolationLevel: "Serializable" },
    ]);
    expect(state.calls.find((call) => call.operation === "family")?.args).toEqual({
      where: { userEmail: TOKEN.userEmail, clientId: TOKEN.clientId },
    });
    const revokes = state.calls.filter((call) => call.operation === "revoke");
    expect(revokes.map((call) => call.args)).toMatchObject([
      { where: { tokenHash: { in: ["parent"] } } },
      { where: { tokenHash: { in: ["parent", "child"] } } },
    ]);
  });

  it("bounds conflicts to three attempts and reports failure instead of a successful disconnect", async () => {
    const { state, stores } = fakePrisma();
    state.conflicts = 10;
    await expect(stores.connections!.disconnect!("user-one", TOKEN.userEmail, "claude"))
      .rejects.toMatchObject({ code: "P2034" });
    expect(state.transactions).toHaveLength(3);
    expect(state.calls).toEqual([]);
  });

  it("never retries unrelated persistence failures", async () => {
    const { state, stores } = fakePrisma();
    state.conflicts = 2;
    state.errorCode = "P1001";
    await expect(stores.refreshTokens.revokeLiveForClient(TOKEN.userEmail, TOKEN.clientId))
      .rejects.toMatchObject({ code: "P1001" });
    expect(state.transactions).toHaveLength(1);
  });

  it("reads at most two indexed successors and refuses branches", async () => {
    const { state, stores } = fakePrisma();
    const successor = { ...TOKEN, tokenHash: "child", rotatedFrom: "parent", revokedAt: null };
    state.successorRows = [successor];
    expect(await stores.refreshTokens.findSuccessor!("parent")).toEqual(successor);
    expect(state.calls[0]).toEqual({
      operation: "successor", args: { where: { rotatedFrom: "parent" }, take: 2 },
    });
    state.successorRows = [successor, { ...successor, tokenHash: "sibling" }];
    expect(await stores.refreshTokens.findSuccessor!("parent")).toBeNull();
  });
});
