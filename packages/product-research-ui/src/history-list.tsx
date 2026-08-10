'use client';

/**
 * Pesquisas recentes: resumable, freshness-stamped. Prices age, so the stamp
 * is first-class — a buyer re-opens yesterday's run knowing it is
 * yesterday's, and one click re-runs from the same query via the form.
 *
 * The block stays BOUNDED (the host hands it the newest few). Two optional
 * host seams keep it that way while answering the production feedback
 * (FUT-494): `onRepeat` re-runs one request's stored query, and `onViewAll`
 * leads to the host's full, filterable history page. Both render only when the
 * host passes them, so every existing consumer keeps compiling and looking the
 * same.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { formatStamp } from './format';
import { resolveMessages, type ResearchMessages } from './messages';
import { isResearchRepeatable } from './repeat-guard';
import type { ResearchRequestView } from './types';

export interface ResearchHistoryListProps {
  requests: ResearchRequestView[];
  onOpen: (requestId: string) => void;
  /**
   * Re-run this request's stored query as a NEW research. Receives the whole
   * view rather than an id because the query the host must re-send lives on it
   * (term, quantity, region, brand, ean, catalogRef) — an id would force the
   * host into a round-trip for data it already rendered.
   */
  onRepeat?: (request: ResearchRequestView) => void;
  /** Leave the bounded block for the host's full history page. */
  onViewAll?: () => void;
  messages?: Partial<ResearchMessages>;
}

function statusChip(request: ResearchRequestView, t: ResearchMessages): JSX.Element {
  const status = request.latestRun?.status;
  if (status === 'COMPLETED') {
    return <Chip label={t.historyStatusDone} size="sm" variant="outlined" color="success" />;
  }
  if (status === 'FAILED') {
    return <Chip label={t.historyStatusFailed} size="sm" variant="outlined" color="danger" />;
  }
  if (status === undefined) {
    return <Chip label={t.historyStatusNone} size="sm" variant="outlined" />;
  }
  return <Chip label={t.historyStatusRunning} size="sm" variant="outlined" color="warning" />;
}

/** One request's row: what it asked for, when, how it ended, and its actions. */
function HistoryRow({
  request,
  onOpen,
  onRepeat,
  t,
}: {
  request: ResearchRequestView;
  onOpen: (requestId: string) => void;
  onRepeat?: (request: ResearchRequestView) => void;
  t: ResearchMessages;
}): JSX.Element {
  // Terminal, or in flight for so long the run is presumed abandoned — see
  // `repeat-guard.ts`. The chip keeps telling the server's story either way.
  const repeatable = isResearchRepeatable(request);
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      data-testid={`research-history-${request.id}`}
    >
      <Text variant="body" as="span">
        {request.term}
      </Text>
      <Text variant="caption" as="span" color="secondary">
        {t.historyQuantity(request.quantity)} · {formatStamp(request.createdAt)}
      </Text>
      {statusChip(request, t)}
      <Button
        variant="text"
        size="sm"
        onClick={() => onOpen(request.id)}
        dataTestId={`research-history-open-${request.id}`}
      >
        {t.historyOpen}
      </Button>
      {onRepeat && (
        <Button
          variant="text"
          size="sm"
          disabled={!repeatable}
          title={repeatable ? undefined : t.historyRepeatRunningHint}
          onClick={() => onRepeat(request)}
          dataTestId={`research-history-repeat-${request.id}`}
        >
          {t.historyRepeat}
        </Button>
      )}
    </Stack>
  );
}

export function ResearchHistoryList({
  requests,
  onOpen,
  onRepeat,
  onViewAll,
  messages,
}: ResearchHistoryListProps): JSX.Element {
  const t = resolveMessages(messages);

  return (
    <Stack spacing={1} data-testid="research-history">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Text variant="heading" as="h3" size="sm">
          {t.historyTitle}
        </Text>
        {onViewAll && (
          <Button
            variant="text"
            size="sm"
            onClick={onViewAll}
            dataTestId="research-history-view-all"
          >
            {t.historyViewAll}
          </Button>
        )}
      </Stack>
      {requests.length === 0 && (
        <Text variant="body" as="p" color="secondary" data-testid="research-history-empty">
          {t.historyEmpty}
        </Text>
      )}
      {requests.map((request) => (
        <HistoryRow
          key={request.id}
          request={request}
          onOpen={onOpen}
          onRepeat={onRepeat}
          t={t}
        />
      ))}
    </Stack>
  );
}
