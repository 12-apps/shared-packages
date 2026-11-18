-- @12-apps/payments-backend owned migration: a part refund's baseline
-- (FUT-4951).
--
-- Before a part's first send, the retrier reads the charge's refunded total
-- back from the provider and keeps it on the series row, with when it was
-- read. Every later attempt measures what is still owed against it, so a
-- part whose answer was lost is adopted, sent in its remainder, or sent again,
-- never twice.
--
-- Additive only: two nullable columns. A release that does not know them
-- never writes them; a rollback leaves two unread columns.

ALTER TABLE "payment_refund_retries" ADD COLUMN "refunded_before_cents" INTEGER;
ALTER TABLE "payment_refund_retries" ADD COLUMN "refunded_before_at" TIMESTAMP(3);
