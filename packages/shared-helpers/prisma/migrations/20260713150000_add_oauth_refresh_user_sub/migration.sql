-- FUT-105: bind the original OAuth subject (`sub`) to each refresh token.
--
-- Previously only `user_email` was stored, so a rotated (refreshed) access token
-- was minted with `subject = <email>`, diverging from the initial token whose
-- `subject = <OAuth sub>`. RFC 6749 §5.1 / OIDC Core §2 require `sub` to be
-- STABLE for a user across every token the AS issues; the divergence broke
-- host-side identity correlation after the first refresh. Storing `user_sub`
-- lets the refresh grant re-mint the successor access token with the SAME `sub`.
--
-- Additive and replay-safe: the PGlite file-db provisioner replays every
-- committed migration into an existing schema, so the column add is guarded
-- (`ADD COLUMN IF NOT EXISTS`). Any pre-existing row is backfilled with '' to
-- satisfy NOT NULL, then the default is dropped so the column matches the Prisma
-- schema (`String`, no default) — the app always supplies a real subject on
-- insert. Dropping a non-existent default is a no-op, so re-running is safe.
ALTER TABLE "oauth_refresh_tokens"
  ADD COLUMN IF NOT EXISTS "user_sub" TEXT NOT NULL DEFAULT '';
ALTER TABLE "oauth_refresh_tokens"
  ALTER COLUMN "user_sub" DROP DEFAULT;
