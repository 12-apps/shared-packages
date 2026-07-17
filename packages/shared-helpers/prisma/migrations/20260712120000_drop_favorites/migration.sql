-- Remove the favorites feature (reverts FUT-96). The per-user record-pin concept
-- was a misread requirement — the admin area keeps saved views ("Visões") for
-- quick access instead. Dropping the table also drops its indexes and the
-- client/user foreign keys.

DROP TABLE IF EXISTS "favorites";
