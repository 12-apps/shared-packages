/**
 * The loop behind a results screen. A start answers with only a requestId —
 * the run is created BY the host's background job — so the hook polls in two
 * phases: the request until `latestRun` appears, then the run until it
 * reaches a terminal status. Every tick re-renders with whatever is known so
 * far, which is what lets the screen open immediately and fill in.
 *
 * With a host-injected realtime channel (FUT-439, see `run-channel.ts`) the
 * loop pauses while the channel is CONNECTED: per-source events then resolve
 * the roster source-by-source and `run-finished` forces the final re-read.
 * Any other state — no channel, connecting, dropped — keeps the polling loop
 * exactly as it always was; that is the no-regression contract.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import type { ResearchApiClient } from './client';
import {
  useDisconnectedRunChannel,
  type ResearchRunWireEvent,
  type UseResearchRunChannel,
} from './run-channel';
import type { ResearchRequestView, ResearchRunView, SourceStatView } from './types';

/** Where the loop currently is, as the screen tells it. */
export type ResearchPhase = 'loading' | 'queued' | 'running' | 'completed' | 'failed' | 'error';

export interface ResearchRunState {
  phase: ResearchPhase;
  request: ResearchRequestView | null;
  run: ResearchRunView | null;
  /**
   * Per-source outcomes known SO FAR: the run's (possibly partial) persisted
   * stats overlaid with channel-delivered ones — what lets a status row
   * resolve the moment its source settles, while slower sources still show
   * as querying. `null` until anything is known.
   */
  sourceStats: SourceStatView[] | null;
  /** The load/API failure when `phase === 'error'`. */
  error: string | null;
  /** Start the loop over (after a transport error). */
  reload: () => void;
}

export interface UseResearchRunOptions {
  intervalMs?: number;
  /**
   * Host-injected realtime subscription (FUT-439). Must be referentially
   * stable for the life of the screen — it is called as a React hook.
   */
  channel?: UseResearchRunChannel;
}

const DEFAULT_INTERVAL_MS = 1200;

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

function resolveOptions(options?: UseResearchRunOptions): {
  intervalMs: number;
  useChannel: UseResearchRunChannel;
} {
  return {
    intervalMs: options?.intervalMs ?? DEFAULT_INTERVAL_MS,
    useChannel: options?.channel ?? useDisconnectedRunChannel,
  };
}

function phaseFor(request: ResearchRequestView | null, run: ResearchRunView | null): ResearchPhase {
  if (request === null) return 'loading';
  if (run === null) return 'queued';
  if (run.status === 'COMPLETED') return 'completed';
  if (run.status === 'FAILED') return 'failed';
  return 'running';
}

/** The run being watched — known only once a poll saw `latestRun`. */
function watchedRunId(
  request: ResearchRequestView | null,
  run: ResearchRunView | null,
): string | null {
  if (run !== null) return run.id;
  if (request !== null && request.latestRun !== null) return request.latestRun.id;
  return null;
}

/** Persisted stats overlaid with live ones, keyed by sourceId (live wins). */
function mergeStats(
  base: SourceStatView[] | null,
  live: SourceStatView[],
): SourceStatView[] | null {
  if (live.length === 0) return base;
  const merged = new Map<string, SourceStatView>();
  for (const stat of base ?? []) merged.set(stat.sourceId, stat);
  for (const stat of live) merged.set(stat.sourceId, stat);
  return [...merged.values()];
}

/**
 * Fold one channel event into the hook's state. Settled stats accumulate;
 * the terminal event is a hint, never the data — offers and the final status
 * come from the API, so it forces the re-read the polling pause deferred.
 */
function applyRunEvent(
  event: ResearchRunWireEvent,
  watchedId: string | null,
  setLiveStats: Dispatch<SetStateAction<SourceStatView[]>>,
  tickRef: RefObject<(() => void) | null>,
): void {
  // A stale run's events (a re-research superseded it) must not bleed in.
  if (event.data.runId !== watchedId) return;
  if (event.type === 'research-run.source-settled') {
    const { stat } = event.data;
    setLiveStats((previous) => [
      ...previous.filter((candidate) => candidate.sourceId !== stat.sourceId),
      stat,
    ]);
    // FUT-519: a source that answered with offers has already persisted them
    // (the engine writes before it emits), so re-read to pull the partial
    // table in. Gated on `offerCount` because that is a RAW connector count,
    // taken before the 0.95 relevance filter — it can over-trigger (one wasted
    // read when everything was filtered out) but can never under-trigger, and
    // erring toward a wasted read is the only safe direction here.
    if (stat.offerCount > 0) tickRef.current?.();
    return;
  }
  if (event.type === 'research-run.finished') tickRef.current?.();
}

interface RunSnapshot {
  request: ResearchRequestView;
  run: ResearchRunView | null;
}

/** One two-phase read: the request, then its latest run when it exists. */
async function readSnapshot(client: ResearchApiClient, requestId: string): Promise<RunSnapshot> {
  const request = await client.getRequest(requestId);
  const run = request.latestRun === null ? null : await client.getRun(request.latestRun.id);
  return { request, run };
}

/** Everything one polling-loop instance reads and writes. */
interface LoopHandles {
  client: RefObject<ResearchApiClient>;
  connected: RefObject<boolean>;
  requestId: string;
  intervalMs: number;
  setRequest: Dispatch<SetStateAction<ResearchRequestView | null>>;
  setRun: Dispatch<SetStateAction<ResearchRunView | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

/**
 * One polling loop. Reschedules itself only while the run is non-terminal
 * AND the channel is not connected — polling PAUSES while the channel
 * streams (the FUT-438 fallback contract): events then drive the screen and
 * `run-finished` calls `tick` for the final re-read. `stop` orphans every
 * in-flight tick for good.
 */
function createPollingLoop(handles: LoopHandles): { tick: () => void; stop: () => void } {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const { request, run } = await readSnapshot(handles.client.current, handles.requestId);
      if (cancelled) return;
      handles.setRequest(request);
      if (run !== null) handles.setRun(run);
      const terminal = run !== null && TERMINAL_STATUSES.has(run.status);
      if (!terminal && !handles.connected.current) {
        timer = setTimeout(() => void tick(), handles.intervalMs);
      }
    } catch (caught) {
      if (cancelled) return;
      handles.setError(caught instanceof Error ? caught.message : 'erro de rede');
    }
  };

  return {
    tick: () => void tick(),
    stop: () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** Owns the loop's lifecycle: fresh state and a fresh loop per request/epoch. */
function usePollingLoop(
  handles: LoopHandles,
  epoch: number,
  tickRef: RefObject<(() => void) | null>,
  setLiveStats: Dispatch<SetStateAction<SourceStatView[]>>,
): void {
  const { client, connected, requestId, intervalMs, setRequest, setRun, setError } = handles;
  useEffect(() => {
    const loop = createPollingLoop({
      client,
      connected,
      requestId,
      intervalMs,
      setRequest,
      setRun,
      setError,
    });
    tickRef.current = loop.tick;
    setRequest(null);
    setRun(null);
    setError(null);
    setLiveStats([]);
    loop.tick();
    return () => {
      tickRef.current = null;
      loop.stop();
    };
    // `client`/`connected` are refs and the setters are stable — the loop
    // restarts only on a new request, a new cadence, or a reload.
  }, [client, connected, requestId, intervalMs, epoch, setRequest, setRun, setError, setLiveStats, tickRef]);
}

/**
 * Channel transitions re-sync once: on CONNECT the re-read catches whatever
 * settled before the subscription was live (events are best-effort); on DROP
 * the same call restarts the loop — tick reschedules itself whenever the
 * channel is not connected.
 */
function useChannelResync(connected: boolean, tickRef: RefObject<(() => void) | null>): void {
  const previous = useRef(connected);
  useEffect(() => {
    if (previous.current === connected) return;
    previous.current = connected;
    tickRef.current?.();
  }, [connected, tickRef]);
}

/** A superseding run (re-research) starts with a clean live slate. */
function useLiveStatsReset(
  runId: string | null,
  setLiveStats: Dispatch<SetStateAction<SourceStatView[]>>,
): void {
  const previous = useRef(runId);
  useEffect(() => {
    if (previous.current === runId) return;
    previous.current = runId;
    setLiveStats((current) => (current.length === 0 ? current : []));
  }, [runId, setLiveStats]);
}

export function useResearchRun(
  client: ResearchApiClient,
  requestId: string,
  options?: UseResearchRunOptions,
): ResearchRunState {
  const { intervalMs, useChannel } = resolveOptions(options);
  const [request, setRequest] = useState<ResearchRequestView | null>(null);
  const [run, setRun] = useState<ResearchRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Stats delivered by channel events for the CURRENT run. */
  const [liveStats, setLiveStats] = useState<SourceStatView[]>([]);
  // Bumped to restart the effect (and to orphan a superseded loop's ticks).
  const [epoch, setEpoch] = useState(0);
  const clientRef = useRef(client);
  clientRef.current = client;

  const runId = watchedRunId(request, run);
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  // The current loop's tick, so events and channel transitions can force a
  // re-read without owning the loop's lifecycle.
  const tickRef = useRef<(() => void) | null>(null);

  const onEvent = useCallback(
    (event: ResearchRunWireEvent) => applyRunEvent(event, runIdRef.current, setLiveStats, tickRef),
    [],
  );

  const { connected } = useChannel({ runId, onEvent });
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  usePollingLoop(
    { client: clientRef, connected: connectedRef, requestId, intervalMs, setRequest, setRun, setError },
    epoch,
    tickRef,
    setLiveStats,
  );
  useChannelResync(connected, tickRef);
  useLiveStatsReset(runId, setLiveStats);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  const baseStats = run === null ? null : run.sourceStats;
  const sourceStats = useMemo(() => mergeStats(baseStats, liveStats), [baseStats, liveStats]);

  return {
    phase: error !== null ? 'error' : phaseFor(request, run),
    request,
    run,
    sourceStats,
    error,
    reload,
  };
}
