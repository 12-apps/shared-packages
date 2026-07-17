-- Per-store payment provider integration (FUT-174). Each store connects its OWN
-- PagBank account instead of the single global env token, so money lands in the
-- store's own merchant account. `credentials` holds an AES-256-GCM ciphertext
-- (v1.<iv>.<tag>.<ct>) of a JSON secrets blob (token / public_key /
-- webhook_token) produced by lib/crypto/field-encryption — never a plaintext
-- secret. `provider`/`environment`/`status` are Strings with DB CHECKs (the same
-- String+CHECK house style used by orders/memberships). `provider` is a closed
-- set today (PAGBANK) but the model is generic enough to add a second provider
-- with no schema redesign.
CREATE TABLE "payment_integrations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'PAGBANK',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "credentials" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_integrations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_integrations_client_id_idx" ON "payment_integrations"("client_id");

-- One integration row per store per provider — the upsert key for saving creds.
CREATE UNIQUE INDEX "payment_integrations_client_id_provider_key" ON "payment_integrations"("client_id", "provider");

-- DB-enforced domain invariants (raw CHECKs — Prisma models can't express these).
-- `provider` is a closed set that grows as providers are added (additive ALTER).
ALTER TABLE "payment_integrations" ADD CONSTRAINT "payment_integrations_provider_valid" CHECK ("provider" IN ('PAGBANK'));
ALTER TABLE "payment_integrations" ADD CONSTRAINT "payment_integrations_environment_valid" CHECK ("environment" IN ('SANDBOX', 'PRODUCTION'));
ALTER TABLE "payment_integrations" ADD CONSTRAINT "payment_integrations_status_valid" CHECK ("status" IN ('UNVERIFIED', 'VERIFIED', 'FAILED'));

-- Integrations belong to a client; deleting the client cascades its integrations.
ALTER TABLE "payment_integrations" ADD CONSTRAINT "payment_integrations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
