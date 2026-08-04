/**
 * The realtime subscription seam (FUT-439) — the same doctrine as
 * {@link ResearchApiClient}: no socket, EventSource or transport code lives
 * in this package. The HOST injects a hook that subscribes to its own
 * realtime channel for one run and reports the connection state; the screens
 * only consume decoded events. Whenever the channel is not connected, the
 * polling loop in `useResearchRun` keeps running exactly as before — realtime
 * is a latency optimisation, never a correctness dependency.
 */
import type { ResearchRunWireEvent } from '@12-apps/product-research';

export type { ResearchRunWireEvent };

export interface ResearchRunChannelInput {
  /**
   * The run to watch, or `null` while none exists yet (the start answers with
   * only a requestId; the run row is created by the host's background job) —
   * the host hook must stay disconnected on `null`.
   */
  runId: string | null;
  /** Called per decoded run-progress event. Latest-callback: never memoize-gated. */
  onEvent: (event: ResearchRunWireEvent) => void;
}

export interface ResearchRunChannelState {
  /** True only while the host's channel is live — the polling pause signal. */
  connected: boolean;
}

/**
 * The injected capability is itself a React hook (the host implements it over
 * its own subscription hook). It MUST be referentially stable for the life of
 * the consuming screen — swapping it between renders would change the hook
 * tree, which React forbids.
 */
export type UseResearchRunChannel = (input: ResearchRunChannelInput) => ResearchRunChannelState;

/** The no-channel default: never connected, so consumers simply poll. */
export const useDisconnectedRunChannel: UseResearchRunChannel = () => ({ connected: false });
