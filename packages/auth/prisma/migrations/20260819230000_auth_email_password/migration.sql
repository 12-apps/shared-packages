-- @12-apps/auth's own tables. Self-contained by design: every user reference is
-- an opaque `user_id` with NO foreign key into a host table, so this migration
-- applies to any schema regardless of what the host calls its users.

CREATE TABLE IF NOT EXISTS "auth_credentials" (
    "user_id"             TEXT NOT NULL,
    "password_hash"       TEXT,
    "password_updated_at" TIMESTAMP(3),
    "email_verified_at"   TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_credentials_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE IF NOT EXISTS "auth_tokens" (
    "id"          TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "purpose"     TEXT NOT NULL,
    "token_hash"  TEXT NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- The purposes, as a CHECK rather than a Prisma enum (house style). A token of
-- one purpose presented to the other endpoint must read as "no such token".
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_purpose_check"
  CHECK ("purpose" IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET'));

-- Unique because the hash IS the lookup key: a collision would mean two
-- accounts sharing one link.
CREATE UNIQUE INDEX IF NOT EXISTS "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");
CREATE INDEX IF NOT EXISTS "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

CREATE TABLE IF NOT EXISTS "auth_platform_settings" (
    "key"        TEXT NOT NULL,
    "value"      JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_platform_settings_pkey" PRIMARY KEY ("key")
);

-- The two switches, seeded to the posture this ships in: the method is OFF
-- until an operator turns it on, and verification is ON so that turning the
-- method on cannot accidentally open unverified registration. Both are the
-- conservative half of their own trade-off.
INSERT INTO "auth_platform_settings" ("key", "value", "updated_at")
VALUES
    ('auth.email_password.enabled', 'false'::jsonb, CURRENT_TIMESTAMP),
    ('auth.email_password.require_verification', 'true'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
