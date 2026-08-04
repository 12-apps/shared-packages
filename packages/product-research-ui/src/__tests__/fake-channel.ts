/**
 * Hand-driven implementation of the run-channel seam (FUT-439): tests flip
 * the connection and push decoded events; the hook under test must pause and
 * resume its polling accordingly. `useSyncExternalStore` makes a connection
 * flip re-render exactly like a real host subscription hook would.
 */
import { useSyncExternalStore } from 'react';

import type { ResearchRunWireEvent, UseResearchRunChannel } from '../run-channel';
import type { SourceStatView } from '../types';

interface ChannelHarness {
  useChannel: UseResearchRunChannel;
  setConnected: (value: boolean) => void;
  emit: (event: ResearchRunWireEvent) => void;
}

export function channelHarness(): ChannelHarness {
  const listeners = new Set<() => void>();
  const state = { connected: false };
  const sink: { onEvent: ((event: ResearchRunWireEvent) => void) | null } = { onEvent: null };

  const useChannel: UseResearchRunChannel = ({ runId, onEvent }) => {
    sink.onEvent = onEvent;
    const connected = useSyncExternalStore(
      (notify) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
      () => state.connected,
    );
    // A real host hook has nothing to subscribe to before the run exists.
    return { connected: connected && runId !== null };
  };

  return {
    useChannel,
    setConnected(value: boolean) {
      state.connected = value;
      for (const notify of [...listeners]) notify();
    },
    emit(event: ResearchRunWireEvent) {
      sink.onEvent?.(event);
    },
  };
}

export function settledEvent(
  stat: Partial<SourceStatView> & { sourceId: string },
  runId = 'run-1',
): ResearchRunWireEvent {
  return {
    type: 'research-run.source-settled',
    data: {
      runId,
      requestId: 'req-1',
      stat: {
        type: 'VTEX',
        name: stat.sourceId,
        status: 'OK',
        offerCount: 1,
        ms: 10,
        ...stat,
      },
    },
  };
}

export function finishedEvent(runId = 'run-1'): ResearchRunWireEvent {
  return {
    type: 'research-run.finished',
    data: { runId, requestId: 'req-1', status: 'COMPLETED' },
  };
}
