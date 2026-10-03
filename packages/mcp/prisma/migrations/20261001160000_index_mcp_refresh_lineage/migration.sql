-- The bounded access-token lineage check follows direct successors only.
CREATE INDEX IF NOT EXISTS "oauth_refresh_tokens_rotated_from_idx" ON "oauth_refresh_tokens"("rotated_from");
