-- FUT-191: an approved card charge is recorded as AUTHORIZED at charge time —
-- before the async webhook/reconcile confirmation upgrades it to PAID — so a
-- captured payment always leaves a durable trace (provider charge id) in our DB.
ALTER TABLE "payments" DROP CONSTRAINT "payments_status_valid";
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_valid" CHECK ("status" IN ('PENDING', 'AUTHORIZED', 'PAID', 'DECLINED'));
