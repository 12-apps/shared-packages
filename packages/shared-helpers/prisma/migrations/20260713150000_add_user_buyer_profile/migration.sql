-- Reusable buyer contact on the user, for checkout pre-fill (opt-in).
-- `phone` is stored as entered. `tax_id` (CPF) holds an AES-256-GCM ciphertext
-- payload (v1.<iv>.<tag>.<ct>) produced by lib/crypto/field-encryption — never a
-- plaintext CPF — so the sensitive PII is encrypted at rest. Both nullable: a
-- buyer who never opts in keeps NULLs, and existing rows backfill to NULL.
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "tax_id" TEXT;
