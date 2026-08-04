import type { ResearchDeps, ResearchRunProgressEvent, ResearchRunScope } from '../ports';
import type { ScoredOffer, SourceRecord, SourceStat } from '../types';

/**
 * Per-source run progress (FUT-439): the pipeline tells the host — through
 * the optional `ResearchEventsPort.runProgress` seam — that a source was
 * asked, that it settled (with its stat and, since FUT-519, its scored
 * offers), and that the run finished. Emission is best-effort by doctrine: a
 * dead observer transport costs an event, never a run. Durable writes always
 * come FIRST (`appendRunOffers` and `appendRunSourceStat` before the settled
 * event, `updateRun` before the finished event), so a subscriber that re-reads
 * on an event can never observe less than the event promised.
 */

const clockOf = (deps: ResearchDeps): (() => Date) => deps.now ?? (() => new Date());

/** Emit through the optional port, swallowing observer failures. */
const emitRunProgress = async (
  deps: ResearchDeps,
  event: ResearchRunProgressEvent,
): Promise<void> => {
  if (!deps.events?.runProgress) return;
  try {
    await deps.events.runProgress(event);
  } catch (error) {
    deps.logger.warn('run-progress event handler failed', {
      runId: event.runId,
      kind: event.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/** The fan-out is about to ask `source`. */
export const notifySourceStarted = (
  deps: ResearchDeps,
  scope: ResearchRunScope,
  source: SourceRecord,
): Promise<void> =>
  emitRunProgress(deps, {
    kind: 'source-started',
    ...scope,
    sourceId: source.id,
    sourceType: source.type,
    sourceName: source.name,
    at: clockOf(deps)(),
  });

/**
 * Persist one source's scored offers mid-run (FUT-519). Optional capability,
 * best-effort — same doctrine as the stat write, because the terminal
 * `insertOffers` replaces whatever landed here with the authoritative set.
 */
const appendOffers = async (
  deps: ResearchDeps,
  scope: ResearchRunScope,
  offers: readonly ScoredOffer[],
): Promise<void> => {
  if (offers.length === 0 || deps.store.appendRunOffers === undefined) return;
  try {
    await deps.store.appendRunOffers({
      clientId: scope.clientId,
      runId: scope.runId,
      offers: [...offers],
    });
  } catch (error) {
    deps.logger.warn('incremental offer write failed', {
      runId: scope.runId,
      offerCount: offers.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * One source settled: persist its offers, then its stat, while the run is
 * still in flight (optional store capabilities, best-effort — the terminal
 * `insertOffers`/`updateRun` write the authoritative sets either way), THEN
 * emit. Never throws.
 *
 * The order lives HERE and not at the call site so no caller can get it wrong:
 * the stat carries `offerCount` and the event is a hint to re-read, so an
 * emission that outran either write would advertise offers the rows do not
 * back yet.
 */
export const notifySourceSettled = async (
  deps: ResearchDeps,
  scope: ResearchRunScope,
  stat: SourceStat,
  offers: readonly ScoredOffer[],
): Promise<void> => {
  await appendOffers(deps, scope, offers);
  try {
    await deps.store.appendRunSourceStat?.({ runId: scope.runId, stat });
  } catch (error) {
    deps.logger.warn('incremental source-stat write failed', {
      runId: scope.runId,
      sourceId: stat.sourceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await emitRunProgress(deps, { kind: 'source-settled', ...scope, stat, at: clockOf(deps)() });
};

/** The run reached a terminal status (emitted AFTER the terminal write). */
export const notifyRunFinished = (
  deps: ResearchDeps,
  scope: ResearchRunScope,
  status: 'COMPLETED' | 'FAILED',
): Promise<void> =>
  emitRunProgress(deps, { kind: 'run-finished', ...scope, status, at: clockOf(deps)() });
