-- @domains: marketplace
-- @12-apps/marketplace: a third reason a store's cancellation request FAILED
-- (FUT-4917). UNREACHABLE is "our own request never got a judgement" (no
-- credentials, a token not granted, a malformed request, retries that ran
-- out); REFUSED stays "the marketplace denied it" and TIMEOUT "no answer in
-- its window".
--
-- Widening a CHECK only accepts more, so the previous release, which never
-- writes the new value, keeps working against the new constraint. Replay-safe:
-- the drop is IF EXISTS and the add follows it.

ALTER TABLE "marketplace_acceptances" DROP CONSTRAINT IF EXISTS "marketplace_acceptances_cancellation_failure_reason_check";

ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_cancellation_failure_reason_check"
    CHECK ("cancellation_failure_reason" IS NULL
           OR "cancellation_failure_reason" IN ('REFUSED', 'UNREACHABLE', 'TIMEOUT'));
