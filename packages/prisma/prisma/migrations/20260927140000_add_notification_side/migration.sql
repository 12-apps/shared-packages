-- @12-apps/notifications: which SIDE of the business a notification is for,
-- and which side a browser subscription's app serves.
--
-- A host that runs a customer-facing app and a staff-facing app for the same
-- people (a shopper who also works at a store) needs each app to show and
-- receive only its own side. Without these columns a staff alert ("novo
-- pedido") lands in the customer app's bell and tray, and a customer's "seu
-- pedido está pronto" lands in the staff app's.
--
-- The vocabulary is the HOST's (`side` has no CHECK, exactly as `category`):
-- the package only compares values. NULL on a notification means "not
-- classified" and every reader sees it; NULL on a subscription means "this app
-- serves every side" and it receives everything. Both are what every EXISTING
-- row reads as, so an adopter that never classifies keeps today's behaviour
-- exactly — additive DDL and a MINOR release, no backfill required here.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "side" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "side" TEXT;
