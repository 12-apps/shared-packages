import { describe, expect, it, vi } from "vitest";

import {
  createPrismaEmailCredentialsStore,
  type AuthDb,
  type EmailIdentity,
  type EmailIdentityDelegate,
} from "../store";

/**
 * The store that replaced a ~170-line adapter in every host.
 *
 * What is worth pinning is the seam: an account with NO credential row is the
 * Google-only account, and the whole "add a password to a social account" flow
 * reads that state. Get it wrong and the security card demands a current
 * password nobody ever had.
 */

const ANA: EmailIdentity = { id: "u1", email: "ana@b.co", name: "Ana" };
/** Fixed, not `Date.now()`: a clock in a test is a reason for it to fail on a Tuesday. */
const AT = new Date("2026-08-19T12:00:00.000Z");

function identityStub(overrides: Partial<EmailIdentityDelegate> = {}): EmailIdentityDelegate {
  return {
    findByEmail: async () => ANA,
    findById: async () => ANA,
    upsert: async () => ANA,
    ...overrides,
  };
}

interface Recorder {
  db: AuthDb;
  credentialUpserts: { where: { userId: string }; update: Record<string, unknown>; create: Record<string, unknown> }[];
  tokenCreates: Record<string, unknown>[];
  tokenDeletes: Record<string, unknown>[];
}

function dbStub(options: {
  credential?: { userId: string; passwordHash: string | null; emailVerifiedAt: Date | null } | null;
  token?: { userId: string; purpose: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null } | null;
  consumedCount?: number;
} = {}): Recorder {
  const credentialUpserts: Recorder["credentialUpserts"] = [];
  const tokenCreates: Record<string, unknown>[] = [];
  const tokenDeletes: Record<string, unknown>[] = [];
  return {
    credentialUpserts,
    tokenCreates,
    tokenDeletes,
    db: {
      authCredential: {
        findUnique: async () => options.credential ?? null,
        upsert: async (args) => {
          credentialUpserts.push({
            where: args.where,
            update: args.update,
            create: args.create,
          });
          return { userId: args.where.userId, passwordHash: null, emailVerifiedAt: null };
        },
      },
      authToken: {
        create: async (args) => {
          tokenCreates.push(args.data);
          return null;
        },
        findUnique: async () => options.token ?? null,
        updateMany: async () => ({ count: options.consumedCount ?? 1 }),
        deleteMany: async (args) => {
          tokenDeletes.push(args.where);
          return null;
        },
      },
    },
  };
}

describe("createPrismaEmailCredentialsStore", () => {
  it("reports no password for an account with no credential row", async () => {
    // The Google-only account. `passwordHash: null` is what `setPassword` reads
    // to decide it must NOT demand a current password — the honest answer to
    // that question is "I have never had one".
    const { db } = dbStub({ credential: null });
    const store = createPrismaEmailCredentialsStore({ getDb: async () => db, identity: identityStub() });

    const user = await store.findByEmail("ana@b.co");

    expect(user).toMatchObject({ id: "u1", email: "ana@b.co", passwordHash: null });
  });

  it("joins the credential onto the identity when there is one", async () => {
    const verifiedAt = new Date("2026-08-19T10:00:00.000Z");
    const { db } = dbStub({
      credential: { userId: "u1", passwordHash: "scrypt$…", emailVerifiedAt: verifiedAt },
    });
    const store = createPrismaEmailCredentialsStore({ getDb: async () => db, identity: identityStub() });

    expect(await store.findById("u1")).toMatchObject({
      passwordHash: "scrypt$…",
      emailVerifiedAt: verifiedAt,
    });
  });

  it("normalises the address before asking the host for it", async () => {
    const findByEmail = vi.fn().mockResolvedValue(ANA);
    const { db } = dbStub();
    const store = createPrismaEmailCredentialsStore({
      getDb: async () => db,
      identity: identityStub({ findByEmail }),
    });

    await store.findByEmail("  ANA@B.CO  ");

    expect(findByEmail).toHaveBeenCalledWith("ana@b.co");
  });

  it("UPSERTS the credential, so a social account can gain a password", async () => {
    // The row is created by whichever of "set a password" or "verify an
    // address" happens first, and either may be first. A plain update here
    // would throw for the account this feature exists to serve.
    const { db, credentialUpserts } = dbStub({ credential: null });
    const store = createPrismaEmailCredentialsStore({ getDb: async () => db, identity: identityStub() });

    await store.setPasswordHash("u1", "scrypt$new");

    expect(credentialUpserts).toMatchObject([
      {
        create: { userId: "u1", passwordHash: "scrypt$new" },
        update: { passwordHash: "scrypt$new" },
      },
    ]);
  });

  it("creates the identity through the host, never behind its back", async () => {
    // `users` is the application's table: the display name, the tenant
    // membership and the order history all hang off it. The package asks.
    const upsert = vi.fn().mockResolvedValue(ANA);
    const { db } = dbStub();
    const store = createPrismaEmailCredentialsStore({
      getDb: async () => db,
      identity: identityStub({ upsert }),
    });

    await store.createUser({ email: "ANA@b.co ", name: "Ana", passwordHash: "scrypt$…" });

    expect(upsert).toHaveBeenCalledWith({ email: "ana@b.co", name: "Ana" });
  });

  it("refuses a token presented to the wrong purpose", async () => {
    // The hash is unique across BOTH purposes. A verification token handed to
    // the reset endpoint must read as "no such token", not as a token of the
    // wrong kind — the two purposes never share a namespace.
    const { db } = dbStub({
      token: {
        userId: "u1",
        purpose: "EMAIL_VERIFICATION",
        tokenHash: "abc",
        expiresAt: AT,
        consumedAt: null,
      },
    });
    const store = createPrismaEmailCredentialsStore({ getDb: async () => db, identity: identityStub() });

    expect(await store.findToken("PASSWORD_RESET", "abc")).toBeNull();
    expect(await store.findToken("EMAIL_VERIFICATION", "abc")).toMatchObject({ userId: "u1" });
  });

  it("lets exactly one of two racing clicks consume the link", async () => {
    // The single-use guarantee comes from the database, not from a prior read:
    // both clicks read the row unconsumed, so only a conditional write can pick
    // a winner. count === 0 means somebody else got there first.
    const winner = createPrismaEmailCredentialsStore({
      getDb: async () => dbStub({ consumedCount: 1 }).db,
      identity: identityStub(),
    });
    const loser = createPrismaEmailCredentialsStore({
      getDb: async () => dbStub({ consumedCount: 0 }).db,
      identity: identityStub(),
    });

    expect(await winner.consumeToken("PASSWORD_RESET", "abc", AT)).toBe(true);
    expect(await loser.consumeToken("PASSWORD_RESET", "abc", AT)).toBe(false);
  });

  it("sweeps a user's outstanding tokens of one purpose only", async () => {
    const { db, tokenDeletes } = dbStub();
    const store = createPrismaEmailCredentialsStore({ getDb: async () => db, identity: identityStub() });

    await store.deleteTokens("u1", "PASSWORD_RESET");

    expect(tokenDeletes).toEqual([{ userId: "u1", purpose: "PASSWORD_RESET" }]);
  });

  it("passes the user id through as an opaque scalar — no row of its own required", async () => {
    // The no-FK property. A host whose user is gone leaves a credential row
    // that simply matches nothing, rather than a constraint violation.
    const { db } = dbStub({ credential: null });
    const store = createPrismaEmailCredentialsStore({
      getDb: async () => db,
      identity: identityStub({ findById: async () => null }),
    });

    expect(await store.findById("long-gone")).toBeNull();
  });
});
