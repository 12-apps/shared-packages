-- @12-apps/notifications: which ORIGIN a browser subscription was
-- registered on.
--
-- A multi-tenant host installs one storefront per store as its own PWA, and a
-- PWA's identity is its ORIGIN — so two stores are two apps. Without this
-- column the Web Push transport fans every notification out to every row a user
-- holds, and store B's push lands inside store A's installed app wearing store
-- A's icon.
--
-- NULL means the PLATFORM origin: the marketplace host itself, or any adopter
-- that serves one origin and has no per-store apps at all. That is why the
-- column is nullable and why every EXISTING row reads correctly with no
-- backfill — an adopter who never had custom domains keeps today's behaviour
-- exactly, which is what makes this a MINOR release rather than a breaking one.
--
-- A by-value scalar with NO foreign key, exactly as `user_id` and
-- `notifications.client_id` already are here (the payments-backend doctrine at
-- the top of `notifications.prisma`): this package must not constrain a host's
-- tenant table, whose name it does not know.
--
-- Additive DDL, so no expand/contract ceremony: the previous release reads a
-- table that has gained a nullable column it never mentions, which is safe.
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "client_id" TEXT;

-- Serves the ONE query the send path makes per notification:
--   user_id = $1 AND ($2 IS NULL OR client_id IS NULL OR client_id = $2)
-- `user_id` leads because it is the selective half and is on every read; the
-- existing `push_subscriptions_user_id_idx` stays for the unscoped counts the
-- settings screen still makes.
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_client_id_idx"
  ON "push_subscriptions" ("user_id", "client_id");
