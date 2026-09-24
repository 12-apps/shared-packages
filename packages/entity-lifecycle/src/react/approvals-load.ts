import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApprovalRequestWire, ApprovalStatusWire, LifecycleApiClient } from './api';
import { LifecycleHttpError } from './transport';

/**
 * The Aprovações inbox read (12-17), and the two ways it re-reads:
 *
 *  - in the FOREGROUND — on mount, on a status chip, after the screen's own
 *    decision and on the error state's retry. The list blanks first and the
 *    loading state shows, because what is on screen is about to be replaced.
 *  - in the BACKGROUND — whenever the host's `refreshSignal` changes value
 *    (FUT-2520: a realtime hint, a window focus). The rows stay mounted while
 *    the same status is read again, and the answer replaces them in place.
 *
 * Every read takes a ticket and only the NEWEST may land, so a read still in
 * flight when the chip changes (it answers for the OLD status) never paints
 * over the new one, and nothing lands after unmount.
 *
 * A background read never supersedes a FOREGROUND one. A signal that arrives
 * while the list is loading — the page's own decision often triggers the very
 * hint that bumps it — is queued, and ONE refresh runs after the load lands.
 * Superseding it instead would drop the load's rows, and a failed refresh
 * would then put an error screen where a good answer was about to be.
 */

interface ApprovalsLoad {
  requests: ApprovalRequestWire[] | null;
  loadError: { status: number | null; message: string } | null;
  /** A foreground re-read (blanks the list). */
  refetch: () => void;
}

type LoadError = NonNullable<ApprovalsLoad['loadError']>;

/** The in-flight bookkeeping: refs, because none of it is ever rendered. */
interface Flight {
  /** The newest read's ticket; only it may land. */
  ticket: number;
  /** A foreground read is in flight. */
  foreground: boolean;
  /** A refresh signal arrived during it, to run once it lands. */
  queued: boolean;
  /** Rows are on screen — what a failed refresh leaves alone. */
  showing: boolean;
}

const loadErrorOf = (error: unknown): LoadError => ({
  status: error instanceof LifecycleHttpError ? error.status : null,
  message: error instanceof Error ? error.message : String(error),
});

/**
 * A failed REFRESH keeps the rows it meant to refresh — they are still the
 * last known queue, and the next signal tries again. Except a 403: the feature
 * was switched off, and the screen says so rather than show a stale queue.
 */
const keepsRows = (flight: Flight, background: boolean, failure: LoadError): boolean =>
  background && flight.showing && failure.status !== 403;

export function useApprovalsLoad(
  api: LifecycleApiClient,
  status: ApprovalStatusWire,
  refreshSignal: unknown,
): ApprovalsLoad {
  const [requests, setRequests] = useState<ApprovalRequestWire[] | null>(null);
  const [loadError, setLoadError] = useState<ApprovalsLoad['loadError']>(null);
  const [generation, setGeneration] = useState(0);
  const flight = useRef<Flight>({ ticket: 0, foreground: false, queued: false, showing: false });

  const read = useCallback(
    function read(background: boolean): void {
      const state = flight.current;
      if (background && state.foreground) {
        state.queued = true;
        return;
      }
      const ticket = ++state.ticket;
      if (!background) {
        // A load issued now is fresher than any signal queued before it.
        Object.assign(state, { foreground: true, queued: false, showing: false });
        setRequests(null);
      }
      const settle = (land: () => void) => {
        if (ticket !== state.ticket) return;
        land();
        if (background) return;
        state.foreground = false;
        if (!state.queued) return;
        state.queued = false;
        read(true);
      };
      api.listApprovals(status).then(
        (payload) =>
          settle(() => {
            state.showing = true;
            setRequests(payload.requests);
            setLoadError(null);
          }),
        (error: unknown) =>
          settle(() => {
            const failure = loadErrorOf(error);
            if (keepsRows(state, background, failure)) return;
            state.showing = false;
            setRequests(null);
            setLoadError(failure);
          }),
      );
    },
    [api, status],
  );

  useEffect(() => {
    read(false);
  }, [read, generation]);

  // The first value is the mount's own read; only a CHANGE re-reads.
  const seenSignal = useRef(refreshSignal);
  useEffect(() => {
    if (Object.is(seenSignal.current, refreshSignal)) return;
    seenSignal.current = refreshSignal;
    read(true);
  }, [read, refreshSignal]);

  // Unmount retires every ticket: a read that answers afterwards lands nowhere.
  useEffect(() => {
    const state = flight.current;
    return () => {
      state.ticket += 1;
    };
  }, []);

  return {
    requests,
    loadError,
    refetch: useCallback(() => setGeneration((value) => value + 1), []),
  };
}
