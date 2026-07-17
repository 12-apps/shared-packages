-- Preferred e-mail for the PagBank charge, distinct from the account `email`
-- (identity). Lets a buyer save a different payment e-mail once and reuse it —
-- e.g. the store owner testing, whose account e-mail equals the merchant e-mail
-- PagBank rejects. Nullable; existing rows → NULL.
ALTER TABLE "users" ADD COLUMN "payment_email" TEXT;
