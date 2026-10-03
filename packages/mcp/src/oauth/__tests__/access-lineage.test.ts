import { describe, expect, it } from "vitest";

import { isRefreshBindingActive } from "../access-binding";
import type { StoredRefreshToken } from "../stores";
import { asHarness } from "./fixtures";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const REVOKED = new Date("2026-09-10T11:00:00.000Z");
const FUTURE = new Date("2026-10-10T12:00:00.000Z");
const ROOT = "a".repeat(64);
const CHILD = "b".repeat(64);
const BINDING = {
  refreshTokenHash: ROOT, clientId: "client-one", email: "owner@example.com",
  subject: "original-sub", issuedAt: NOW / 1000,
};

function row(tokenHash: string, overrides: Partial<StoredRefreshToken> = {}): StoredRefreshToken {
  return {
    tokenHash, clientId: BINDING.clientId, userEmail: BINDING.email, userSub: BINDING.subject,
    scopes: ["mcp:read"], expiresAt: FUTURE, rotatedFrom: null, revokedAt: null, ...overrides,
  };
}

async function chain(rows: StoredRefreshToken[]) {
  const h = await asHarness();
  const calls = { successors: 0 };
  const store = {
    ...h.stores.refreshTokens,
    findByHash: async (hash: string) => rows.find((candidate) => candidate.tokenHash === hash) ?? null,
    findSuccessor: async (hash: string) => {
      calls.successors += 1;
      const found = rows.filter((candidate) => candidate.rotatedFrom === hash);
      return found.length === 1 ? found[0]! : null;
    },
  };
  return { store, calls };
}

describe("bounded exact refresh lineage", () => {
  it("permits a live descendant even after the rotated ancestor's expiry", async () => {
    const { store } = await chain([
      row(ROOT, { revokedAt: REVOKED, expiresAt: REVOKED }), row(CHILD, { rotatedFrom: ROOT }),
    ]);
    expect(await isRefreshBindingActive(store, BINDING, NOW)).toBe(true);
  });

  it("refuses a fully revoked family even if reconnect created another live root", async () => {
    const { store } = await chain([
      row(ROOT, { revokedAt: REVOKED }), row(CHILD, { rotatedFrom: ROOT, revokedAt: REVOKED }),
      row("c".repeat(64)),
    ]);
    expect(await isRefreshBindingActive(store, BINDING, NOW)).toBe(false);
  });

  it("refuses ambiguous branching instead of picking one live successor", async () => {
    const { store } = await chain([
      row(ROOT, { revokedAt: REVOKED }), row(CHILD, { rotatedFrom: ROOT }),
      row("c".repeat(64), { rotatedFrom: ROOT }),
    ]);
    expect(await isRefreshBindingActive(store, BINDING, NOW)).toBe(false);
  });

  it("refuses cycles, mismatched successor identity and malformed links", async () => {
    const cycle = await chain([
      row(ROOT, { revokedAt: REVOKED, rotatedFrom: CHILD }),
      row(CHILD, { revokedAt: REVOKED, rotatedFrom: ROOT }),
    ]);
    expect(await isRefreshBindingActive(cycle.store, BINDING, NOW)).toBe(false);
    const otherUser = await chain([
      row(ROOT, { revokedAt: REVOKED }), row(CHILD, { rotatedFrom: ROOT, userEmail: "other@example.com" }),
    ]);
    expect(await isRefreshBindingActive(otherUser.store, BINDING, NOW)).toBe(false);
    const malformed = await chain([row(ROOT, { revokedAt: REVOKED })]);
    malformed.store.findSuccessor = async () => row(CHILD);
    expect(await isRefreshBindingActive(malformed.store, BINDING, NOW)).toBe(false);
  });

  it("refuses a rotated binding without successor lookup support", async () => {
    const { store } = await chain([row(ROOT, { revokedAt: REVOKED })]);
    const withoutLookup = { ...store, findSuccessor: undefined };
    expect(await isRefreshBindingActive(withoutLookup, BINDING, NOW)).toBe(false);
  });

  it("permits 32 hops, but bounds work and refuses a longer chain", async () => {
    const rows = [row(ROOT, { revokedAt: REVOKED })];
    for (let index = 1; index <= 33; index += 1) {
      rows.push(row(index.toString(16).padStart(64, "0"), {
        rotatedFrom: rows[index - 1]!.tokenHash, revokedAt: index === 33 ? null : REVOKED,
      }));
    }
    const long = await chain(rows);
    expect(await isRefreshBindingActive(long.store, BINDING, NOW)).toBe(false);
    expect(long.calls.successors).toBe(32);
    const bounded = await chain(rows.slice(0, 33).map((item, index) => index === 32 ? { ...item, revokedAt: null } : item));
    expect(await isRefreshBindingActive(bounded.store, BINDING, NOW)).toBe(true);
    expect(bounded.calls.successors).toBe(32);
  });
});
