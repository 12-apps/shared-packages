-- The account-deletion outbox's send lease: the one pass sending an owed mail
-- takes it first, so two passes never both send. Additive and nullable.
ALTER TABLE "auth_account_states" ADD COLUMN "mail_claimed_at" TIMESTAMP(3);
