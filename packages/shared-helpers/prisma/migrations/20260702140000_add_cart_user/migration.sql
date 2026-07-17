-- Add carts.user_id (FUT-44 cart-per-user): links a cart to a signed-in user so
-- it persists across sign-out and is restored/merged on the next sign-in.
ALTER TABLE "carts" ADD COLUMN "user_id" TEXT;

-- One persisted cart per user. The column is nullable and a Postgres UNIQUE
-- index treats each NULL as distinct, so the many anonymous carts (user_id NULL)
-- are unaffected — only at most one non-null user_id may repeat.
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- Deleting a user cascades their persisted cart away (keeps the vault clean and
-- is LGPD-friendly).
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
