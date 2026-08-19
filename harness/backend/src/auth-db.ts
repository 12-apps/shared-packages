import type { PGlite } from '@electric-sql/pglite';

/**
 * The tables a host owns for `@12-apps/auth`'s e-mail + password flow — and the
 * reason this file is HAND-WRITTEN where every other harness surface applies a
 * migration out of its package's tarball.
 *
 * `@12-apps/auth` ships no migration and owns no model, deliberately. An
 * account is the host's row: it already has an id, a display name, a tenant, a
 * created_at and whatever else that product needs, and a package that brought
 * its own `users` table would be a second answer to a question every adopter
 * has already answered. What the package states instead is a PORT
 * (`EmailCredentialsStore`), and the four columns it needs to see.
 *
 * So this is what an adopter writes, and writing it here is the point: if the
 * port could not be satisfied by an ordinary schema, that would be a defect in
 * the package rather than a note in its README.
 *
 * The token table is the one place the shape is not free. `consumeToken` must
 * be a CONDITIONAL write — see the port's own docs — because two clicks of one
 * link race, and a read-then-write loses that race silently. `consumed_at` is
 * therefore nullable and the update carries `WHERE consumed_at IS NULL`.
 */

/** Everything, from nothing. Replay-safe, so a reseed is not a failure. */
export async function applyAuthMigrations(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id                TEXT PRIMARY KEY,
      email             TEXT NOT NULL UNIQUE,
      name              TEXT,
      password_hash     TEXT,
      email_verified_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      user_id     TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      PRIMARY KEY (purpose, token_hash)
    );

    CREATE TABLE IF NOT EXISTS auth_settings (
      key        TEXT PRIMARY KEY,
      value      BOOLEAN NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ
    );

    -- The mailer's outbox. A real adopter hands the rendered message to a
    -- vendor; this one keeps it, because the journeys READ what was sent and
    -- click the link inside it. That is the whole reason they prove anything:
    -- a scenario that seeded its own token would pass with a broken appUrl.
    CREATE TABLE IF NOT EXISTS auth_sent_mail (
      id       SERIAL PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject  TEXT NOT NULL,
      body     TEXT NOT NULL,
      sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/** The platform operator — the only seeded account. See {@link reseedAuth}. */
export const AUTH_OPERATOR_EMAIL = 'operator@example.test';

/**
 * Back to the starting fixture: one operator, no shoppers, no tokens, both
 * switches on.
 *
 * The operator exists because the two settings endpoints are session-gated and
 * this host resolves a session to a USER ROW. That is not incidental to the
 * test: a platform switch that an anonymous caller could flip is exactly the
 * failure those routes are separately mounted to prevent, so the harness has to
 * have somebody to be.
 */
export async function reseedAuth(pg: PGlite): Promise<void> {
  await pg.exec(`
    DELETE FROM auth_tokens;
    DELETE FROM auth_sent_mail;
    DELETE FROM auth_users;
    INSERT INTO auth_users (id, email, name, password_hash, email_verified_at)
         VALUES ('operator', '${AUTH_OPERATOR_EMAIL}', 'Platform Operator', NULL, NOW());
    INSERT INTO auth_settings (key, value, updated_by, updated_at)
         VALUES ('enabled', TRUE, NULL, NULL),
                ('requireEmailVerification', TRUE, NULL, NULL)
    ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_by = NULL, updated_at = NULL;
  `);
}
