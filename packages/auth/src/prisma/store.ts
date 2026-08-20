import type {
  AuthTokenPurpose,
  EmailCredentialUser,
  EmailCredentialsStore,
  StoredAuthToken,
} from "../email-credentials/types";

/**
 * The `EmailCredentialsStore`, over this package's OWN tables.
 *
 * ## Why this is here and not in every host
 *
 * It used to be a ~170-line file in the application, because the package owned
 * no tables and the password therefore had to live on the host's `users` row.
 * That made "install a login flow" mean "hand-edit your own user model, add
 * three columns and a foreign-keyed token table, then write the adapter" — and
 * every host would have written the same adapter, differently.
 *
 * `prisma/auth.prisma` now owns `auth_credentials`, `auth_tokens` and
 * `auth_platform_settings`, copied into the host's schema folder by
 * `prisma:sync`, with migrations the host discovers structurally. So the only
 * thing left for a host to supply is the half a package genuinely cannot know:
 * **who its users are.**
 *
 * ## The identity delegate, and why it is irreducible
 *
 * `users` is the application's table. It holds the display name, the tenant
 * membership, the order history — none of which is auth's business, and no
 * package should be creating rows in it blind. So {@link EmailIdentityDelegate}
 * stays with the host, at three small methods, and everything else moved.
 *
 * The user id crosses that boundary as an OPAQUE STRING, the same way
 * `report-builder` keeps `createdBy` as "the host's user id, kept as an opaque
 * scalar". No foreign key, so a stale id simply matches no credential row.
 */

/** Identity, as this package needs to see it. The host owns the wider row. */
export interface EmailIdentity {
  id: string;
  email: string;
  name?: string | null;
}

/**
 * The three things only the host can answer. Everything else is in this file.
 *
 * `upsert` rather than `create`: a row can already exist for an address that has
 * never signed in — a checkout pre-fill or a team invite both write one — and
 * for those, registering is filling in a name, not colliding.
 */
export interface EmailIdentityDelegate {
  findByEmail(email: string): Promise<EmailIdentity | null>;
  findById(id: string): Promise<EmailIdentity | null>;
  upsert(input: { email: string; name?: string | null }): Promise<EmailIdentity>;
}

/** A credential row as this package stores it. */
interface CredentialRow {
  userId: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
}

/** A token row as this package stores it. */
interface TokenRow {
  userId: string;
  purpose: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * The host client delegates this store writes — STRUCTURAL, never generated.
 *
 * Typed by shape rather than by importing `@prisma/client`, so this package
 * never resolves the host's generated client and stays installable in a repo
 * whose client is generated somewhere else entirely. Same convention as
 * `report-builder`'s `SavedReportDb`.
 */
export interface AuthDb {
  authCredential: {
    findUnique(args: { where: { userId: string } }): Promise<CredentialRow | null>;
    upsert(args: {
      where: { userId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<CredentialRow>;
  };
  authToken: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findUnique(args: { where: { tokenHash: string } }): Promise<TokenRow | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

/** Resolved per call, not at import: a host may build its client lazily. */
export type AuthDbProvider = () => Promise<AuthDb>;

export interface PrismaCredentialsStoreConfig {
  /** How to reach the client carrying this package's models. */
  getDb: AuthDbProvider;
  /** The half only the host can answer. See {@link EmailIdentityDelegate}. */
  identity: EmailIdentityDelegate;
}

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * Join an identity with its credential row into what the flow expects.
 *
 * An account with no credential row is not an error: it is somebody who has
 * only ever signed in with Google, and `passwordHash: null` is precisely the
 * state `setPassword` reads to decide it must not demand a current password.
 */
function merge(
  identity: EmailIdentity,
  credential: CredentialRow | null,
): EmailCredentialUser {
  return {
    id: identity.id,
    email: identity.email,
    name: identity.name ?? null,
    passwordHash: credential?.passwordHash ?? null,
    emailVerifiedAt: credential?.emailVerifiedAt ?? null,
  };
}

export function createPrismaEmailCredentialsStore(
  config: PrismaCredentialsStoreConfig,
): EmailCredentialsStore {
  const { getDb, identity } = config;

  const withCredential = async (
    found: EmailIdentity | null,
  ): Promise<EmailCredentialUser | null> => {
    if (!found) return null;
    const db = await getDb();
    const credential = await db.authCredential.findUnique({ where: { userId: found.id } });
    return merge(found, credential);
  };

  const writeCredential = async (
    userId: string,
    fields: Record<string, unknown>,
  ): Promise<void> => {
    const db = await getDb();
    await db.authCredential.upsert({
      where: { userId },
      update: fields,
      // An upsert on every write: the row is created by whichever of "set a
      // password" or "verify an address" happens first, and either may be
      // first — a social account adding a password has no row yet.
      create: { userId, ...fields },
    });
  };

  return {
    async findByEmail(email) {
      return withCredential(await identity.findByEmail(normalize(email)));
    },

    async findById(id) {
      return withCredential(await identity.findById(id));
    },

    async createUser(input) {
      const found = await identity.upsert({
        email: normalize(input.email),
        name: input.name ?? null,
      });
      await writeCredential(found.id, {
        passwordHash: input.passwordHash,
        passwordUpdatedAt: new Date(),
        ...(input.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: input.emailVerifiedAt }),
      });
      return merge(found, {
        userId: found.id,
        passwordHash: input.passwordHash,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
      });
    },

    async setPasswordHash(userId, passwordHash) {
      await writeCredential(userId, { passwordHash, passwordUpdatedAt: new Date() });
    },

    async markEmailVerified(userId, verifiedAt) {
      await writeCredential(userId, { emailVerifiedAt: verifiedAt });
    },

    ...tokenMethods(getDb),
  };
}

/**
 * The token half, split out because the store crossed the 80-line function
 * budget — and because these four are one subject: a single-use link's whole
 * life, from minted to consumed to swept.
 */
function tokenMethods(getDb: AuthDbProvider): Pick<
  EmailCredentialsStore,
  "saveToken" | "findToken" | "consumeToken" | "deleteTokens"
> {
  return {
    async saveToken(input) {
      const db = await getDb();
      await db.authToken.create({
        data: {
          userId: input.userId,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
    },

    async findToken(purpose, tokenHash) {
      const db = await getDb();
      const row = await db.authToken.findUnique({ where: { tokenHash } });
      // The hash is unique across BOTH purposes, so the purpose is checked here
      // rather than in the lookup: a verification token presented to the reset
      // endpoint must read as "no such token", not as a token of the wrong kind.
      if (!row || row.purpose !== purpose) return null;
      return {
        userId: row.userId,
        purpose: row.purpose as AuthTokenPurpose,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        consumedAt: row.consumedAt,
      } satisfies StoredAuthToken;
    },

    /**
     * The single-use guarantee, and the reason it is an `updateMany` with the
     * predicate in the WHERE rather than a read followed by a write.
     *
     * Two clicks of one link race. Both would read the row unconsumed, and both
     * would then stamp it — so the only thing that can pick a winner is the
     * database. `count === 1` means THIS call is the one that consumed it.
     */
    async consumeToken(purpose, tokenHash, consumedAt) {
      const db = await getDb();
      const { count } = await db.authToken.updateMany({
        where: { tokenHash, purpose, consumedAt: null },
        data: { consumedAt },
      });
      return count === 1;
    },

    async deleteTokens(userId, purpose) {
      const db = await getDb();
      await db.authToken.deleteMany({ where: { userId, purpose } });
    },
  };
}
