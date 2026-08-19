import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import type {
  AuthTokenPurpose,
  EmailCredentialUser,
  EmailCredentialsStore,
  StoredAuthToken,
} from '@12-apps/auth/email-credentials';
import type { EmailAuthSettings } from '@12-apps/auth/email-credentials';
import type { EmailAuthSettingsStore } from '@12-apps/auth/server';

/**
 * `EmailCredentialsStore` and `EmailAuthSettingsStore`, over the tables in
 * `auth-db.ts`.
 *
 * Eleven one-statement methods, which is the claim being tested: the port is
 * small enough that an adopter fills it in an afternoon, and nothing in it
 * needs a transaction, a trigger or a stored procedure. A real host writes
 * these against Prisma; the shapes are identical either way.
 */

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  email_verified_at: string | null;
}

function toUser(row: UserRow): EmailCredentialUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at) : null,
  };
}

/** The account half of the port: four statements over `auth_users`. */
function userMethods(
  pg: PGlite,
): Pick<
  EmailCredentialsStore,
  'findByEmail' | 'findById' | 'createUser' | 'setPasswordHash' | 'markEmailVerified'
> {
  const one = async (sql: string, params: unknown[]): Promise<EmailCredentialUser | null> => {
    const { rows } = await pg.query<UserRow>(sql, params);
    return rows[0] ? toUser(rows[0]) : null;
  };

  return {
    findByEmail: (email) => one('SELECT * FROM auth_users WHERE email = $1', [email]),

    findById: (id) => one('SELECT * FROM auth_users WHERE id = $1', [id]),

    createUser: async ({ email, name, passwordHash, emailVerifiedAt }) => {
      const user = await one(
        `INSERT INTO auth_users (id, email, name, password_hash, email_verified_at)
              VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
        [randomUUID(), email, name ?? null, passwordHash, emailVerifiedAt ?? null],
      );
      // The insert cannot return nothing; narrowing here beats a non-null
      // assertion, which is what the repo's own rules ask for.
      if (!user) throw new Error(`the account for ${email} was not created`);
      return user;
    },

    setPasswordHash: async (userId, passwordHash) => {
      await pg.query('UPDATE auth_users SET password_hash = $2 WHERE id = $1', [
        userId,
        passwordHash,
      ]);
    },

    markEmailVerified: async (userId, verifiedAt) => {
      await pg.query('UPDATE auth_users SET email_verified_at = $2 WHERE id = $1', [
        userId,
        verifiedAt,
      ]);
    },
  };
}

/**
 * The token half: four statements over `auth_tokens`.
 *
 * Split from the accounts above because the two are genuinely different
 * subjects — an account outlives every token issued against it — and because
 * `consumeToken` is the one method here whose SHAPE is dictated rather than
 * chosen.
 */
function tokenMethods(
  pg: PGlite,
): Pick<EmailCredentialsStore, 'saveToken' | 'findToken' | 'consumeToken' | 'deleteTokens'> {
  return {
    saveToken: async ({ userId, purpose, tokenHash, expiresAt }) => {
      await pg.query(
        `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
              VALUES ($1, $2, $3, $4)`,
        [userId, purpose, tokenHash, expiresAt],
      );
    },

    findToken: async (purpose, tokenHash) => {
      const { rows } = await pg.query<{
        user_id: string;
        purpose: string;
        token_hash: string;
        expires_at: string;
        consumed_at: string | null;
      }>('SELECT * FROM auth_tokens WHERE purpose = $1 AND token_hash = $2', [
        purpose,
        tokenHash,
      ]);
      const row = rows[0];
      if (!row) return null;
      const stored: StoredAuthToken = {
        userId: row.user_id,
        purpose: row.purpose as AuthTokenPurpose,
        tokenHash: row.token_hash,
        expiresAt: new Date(row.expires_at),
        consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      };
      return stored;
    },

    /**
     * The single-use guarantee, and the one method whose SHAPE is dictated.
     *
     * `WHERE consumed_at IS NULL` makes the database the arbiter, so two clicks
     * of a forwarded link cannot both win. Reading the row first and updating
     * it after would pass every test written serially and fail the day two
     * people open the same mail.
     */
    consumeToken: async (purpose, tokenHash, consumedAt) => {
      const { affectedRows } = await pg.query(
        `UPDATE auth_tokens SET consumed_at = $3
          WHERE purpose = $1 AND token_hash = $2 AND consumed_at IS NULL`,
        [purpose, tokenHash, consumedAt],
      );
      return (affectedRows ?? 0) > 0;
    },

    deleteTokens: async (userId, purpose) => {
      await pg.query('DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2', [
        userId,
        purpose,
      ]);
    },
  };
}

/** The port `createEmailCredentials` takes, from its two halves. */
export function authStore(pg: PGlite): EmailCredentialsStore {
  return { ...userMethods(pg), ...tokenMethods(pg) };
}

interface SettingRow {
  key: string;
  value: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

/** The two operator switches, as `@12-apps/auth/server`'s settings routes read them. */
export function authSettingsStore(pg: PGlite): EmailAuthSettingsStore & {
  current: () => Promise<EmailAuthSettings>;
} {
  const rows = async (): Promise<SettingRow[]> =>
    (await pg.query<SettingRow>('SELECT * FROM auth_settings')).rows;

  const current = async (): Promise<EmailAuthSettings> => {
    const all = await rows();
    const value = (key: string): boolean => all.find((row) => row.key === key)?.value ?? false;
    return {
      enabled: value('enabled'),
      requireEmailVerification: value('requireEmailVerification'),
    };
  };

  return {
    current,
    read: async () => ({
      settings: await current(),
      audit: (await rows()).map((row) => ({
        key: row.key,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      })),
    }),
    /**
     * Only the keys PRESENT are written, which is what lets the two switches
     * move independently — a console that saved both on every change would
     * overwrite whatever another operator had just flipped.
     */
    write: async (changes, updatedBy) => {
      for (const [key, value] of Object.entries(changes)) {
        if (typeof value !== 'boolean') continue;
        await pg.query(
          `INSERT INTO auth_settings (key, value, updated_by, updated_at)
                VALUES ($1, $2, $3, NOW())
           ON CONFLICT (key) DO UPDATE
                   SET value = EXCLUDED.value,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = EXCLUDED.updated_at`,
          [key, value, updatedBy],
        );
      }
    },
  };
}
