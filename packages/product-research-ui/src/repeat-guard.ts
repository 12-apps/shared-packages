/**
 * When a research may be repeated — the one rule behind BOTH the "Pesquisas
 * recentes" block's Repetir button and the host history grid's Repetir kebab
 * item, so the two surfaces can never disagree about a row.
 *
 * Host-agnostic on purpose: a plain function plus a constant horizon, no host
 * import and no clock injection beyond an optional `now` (the callers pass
 * nothing; tests pass a fixed instant or drive fake timers).
 */
import type { ResearchRequestView } from './types';

/**
 * How long a run may sit in a NON-terminal state before the UI stops treating
 * it as live.
 *
 * Nothing reaps a run stuck in RUNNING: a worker killed mid-run (deploy, OOM)
 * leaves the row RUNNING forever, and the host's recovery sweep only re-enqueues
 * requests that have NO run at all. Without a horizon such a request is a dead
 * end — "em andamento" for good, Repetir never offered, and the only way to
 * re-price the query is to retype it.
 *
 * 15 minutes is the host pipeline's own worst-case recovery cycle: its research
 * sweep runs every 10 minutes and holds a 5-minute lease, so a run still in
 * flight past that has outlived every window the backend has to notice it. Runs
 * themselves finish in seconds (a bounded fan-out over price sources, three job
 * attempts spaced 5s/10s/20s), which leaves the horizon orders of magnitude
 * clear of a healthy run.
 */
export const RESEARCH_RUN_STALE_AFTER_MS = 15 * 60_000;

/**
 * Whether this request's stored query may be re-run.
 *
 * A terminal latest run (COMPLETED | FAILED) is repeatable — retrying a failure
 * is the point, and re-pricing a finished search is the feature. A run still in
 * flight is NOT: repeating it would fan the same query out over the paid sources
 * a second time for an answer already on its way. A request with no run row yet
 * is queued, not finished.
 *
 * The exception is staleness: past {@link RESEARCH_RUN_STALE_AFTER_MS} since it
 * STARTED, an in-flight run is presumed abandoned and Repetir is offered again.
 * This only decides whether the action is OFFERED — the run's own state and the
 * row's status chip are the server's to change, never the UI's.
 *
 * A run with no `startedAt` (queued, or a row written without the stamp) has no
 * clock to age against and stays non-repeatable; so does an unparseable stamp.
 */
export function isResearchRepeatable(
  request: ResearchRequestView,
  now: number = Date.now(),
): boolean {
  const run = request.latestRun;
  if (!run) return false;
  if (run.status === 'COMPLETED' || run.status === 'FAILED') return true;
  if (run.startedAt === null) return false;
  const startedAt = Date.parse(run.startedAt);
  return Number.isFinite(startedAt) && now - startedAt >= RESEARCH_RUN_STALE_AFTER_MS;
}
