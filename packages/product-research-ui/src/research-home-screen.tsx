'use client';

/**
 * The research home: the form on top, resumable recent researches below.
 * Fetches through the injected client only; opening a request is the host's
 * navigation.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';

import type { ResearchApiClient } from './client';
import { ResearchHistoryList } from './history-list';
import type { ResearchMessages } from './messages';
import { ResearchForm } from './research-form';
import type { ResearchRequestView } from './types';

export interface ResearchHomeScreenProps {
  client: ResearchApiClient;
  /** Host navigation to the request's live screen. */
  onOpenRequest: (requestId: string) => void;
  /**
   * Re-run a listed request's stored query (FUT-494). Owned by the host so the
   * repeat lands the user exactly where a form submit does; omit it and the
   * per-row action is not rendered.
   */
  onRepeatRequest?: (request: ResearchRequestView) => void;
  /** Host navigation to the full history page; omit it and no link renders. */
  onViewAllRequests?: () => void;
  defaultRegion?: string;
  defaultTerm?: string;
  defaultQuantity?: number;
  historyPageSize?: number;
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
}

export function ResearchHomeScreen({
  client,
  onOpenRequest,
  onRepeatRequest,
  onViewAllRequests,
  defaultRegion,
  defaultTerm,
  defaultQuantity,
  historyPageSize = 10,
  messages,
}: ResearchHomeScreenProps): JSX.Element {
  const [requests, setRequests] = useState<ResearchRequestView[]>([]);

  const load = useCallback(() => {
    client
      .listRequests({ page: 1, pageSize: historyPageSize })
      .then((result) => setRequests(result.data))
      .catch(() => {
        // History is a convenience; the form works without it.
      });
  }, [client, historyPageSize]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack spacing={4} data-testid="research-home">
      <ResearchForm
        client={client}
        onStarted={onOpenRequest}
        defaultRegion={defaultRegion}
        defaultTerm={defaultTerm}
        defaultQuantity={defaultQuantity}
        messages={messages}
      />
      <ResearchHistoryList
        requests={requests}
        onOpen={onOpenRequest}
        onRepeat={onRepeatRequest}
        onViewAll={onViewAllRequests}
        messages={messages}
      />
    </Stack>
  );
}
