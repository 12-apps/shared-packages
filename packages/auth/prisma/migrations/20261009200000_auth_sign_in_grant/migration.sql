-- A third token purpose, SIGN_IN_GRANT (FUT-3474): the half of a confirmation
-- link that only the browser which signed up can spend. Widening the CHECK is
-- additive — the previous release never writes the new value, and every value
-- it does write is still allowed.
ALTER TABLE "auth_tokens" DROP CONSTRAINT IF EXISTS "auth_tokens_purpose_check";
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_purpose_check"
  CHECK ("purpose" IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'SIGN_IN_GRANT'));
