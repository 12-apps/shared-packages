-- FUT-496: a time-only index on research_runs.
--
-- The host's superadmin diagnostics inbox reads recent runs ACROSS EVERY TENANT
-- ("every failed source in the last 24 h"), i.e. `created_at >= $1` with no
-- client_id bound. The existing `(client_id, created_at)` index cannot serve
-- that predicate — its leading column is unbound and PostgreSQL has no btree
-- skip scan — so the planner falls back to a Parallel Seq Scan over the whole
-- table. research_runs has no retention/pruning job, so that scan only ever
-- gets more expensive. A tenant-scoped read is unaffected: it keeps using the
-- composite index, which is strictly better for it.

CREATE INDEX "research_runs_created_at_idx" ON "research_runs"("created_at");
