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
 * Every read takes a ticket and only the NEWEST may land. A background read
 * still in flight when the chip changes answers for the OLD status, and would
 * otherwise paint its rows over the new status's.
 */

interface ApprovalsLoad {
  requests: ApprovalRequestWire[] | null;
  loadError: { status: number | null; message: string } | null;
  /** A foreground re-read (blanks the list). */
  refetch: () => void;
}

const loadErrorOf = (error: unknown): NonNullable<ApprovalsLoad['loadError']> => ({
  status: error instanceof LifecycleHttpError ? error.status : null,
  message: error instanceof Error ? error.message : String(error),
});

export function useApprovalsLoad(
  api: LifecycleApiClient,
  status: ApprovalStatusWire,
  refreshSignal: unknown,
): ApprovalsLoad {
  const [requests, setRequests] = useState<ApprovalRequestWire[] | null>(null);
  const [loadError, setLoadError] = useState<ApprovalsLoad['loadError']>(null);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);
  // Whether rows are on screen — what a failed background read leaves alone.
  const showing = useRef(false);

  const read = useCallback(
    (background: boolean) => {
      const ticket = ++latest.current;
      if (!background) {
        showing.current = false;
        setRequests(null);
      }
      api.listApprovals(status).then(
        (payload) => {
          if (ticket !== latest.current) return;
          showing.current = true;
          setRequests(payload.requests);
          setLoadError(null);
        },
        (error: unknown) => {
          if (ticket !== latest.current) return;
          // A failed REFRESH keeps the rows it meant to refresh: they are
          // still the last known queue, and the next signal tries again.
          if (background && showing.current) return;
          setLoadError(loadErrorOf(error));
        },
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

  return {
    requests,
    loadError,
    refetch: useCallback(() => setGeneration((value) => value + 1), []),
  };
}
