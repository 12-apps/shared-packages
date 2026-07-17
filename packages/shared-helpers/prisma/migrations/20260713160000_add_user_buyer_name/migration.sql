-- Custom buyer name for checkout pre-fill, kept separate from `name` (the OAuth
-- display name, refreshed on every sign-in via upsertOnSignIn) so a buyer's
-- chosen name on the receipt isn't overwritten. Nullable; existing rows → NULL.
ALTER TABLE "users" ADD COLUMN "buyer_name" TEXT;
