-- Multi-tenant cart: a signed-in user has one cart PER TENANT instead of one
-- globally. Drop the global `user_id` unique and key it on (user_id, client_id).
-- A NULL `user_id` (anonymous cart) stays distinct in a Postgres/PGlite unique
-- index, so anonymous carts never collide.
DROP INDEX "carts_user_id_key";
CREATE UNIQUE INDEX "carts_user_id_client_id_key" ON "carts"("user_id", "client_id");
