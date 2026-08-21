'use client';

/**
 * One research, live: opens immediately, fills in as the poll — or the
 * host's realtime channel (FUT-439) — advances, each source's status row
 * resolving the moment that source settles. Degradation is loud (a failed
 * source is a banner, never a silently shorter list), the winner is a hero
 * card, and the no-results state teaches what to try next instead of
 * shrugging.
 */
import { useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { BestOfferCard } from './best-offer-card';
import type { ResearchApiClient } from './client';
import { resolveMessages, type ResearchMessages } from './messages';
import { OffersTable } from './offers-table';
import type { UseResearchRunChannel } from './run-channel';
import { SourceStatusList } from './source-status';
import type { ResearchRequestView, ResearchRunView, SourceSummary } from './types';
import { useResearchRun, type ResearchPhase } from './use-research-run';

export interface ResearchRunScreenProps {
  client: ResearchApiClient;
  requestId: string;
  /**
   * Host-injected realtime subscription for per-source streaming (FUT-439).
   * Optional — without it the screen polls exactly as before. Must be
   * referentially stable for the life of the screen (it is used as a hook).
   */
  runChannel?: UseResearchRunChannel;
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
}

/** The roster read once — the status rows shown while the run is in flight. */
function useSourceRoster(client: ResearchApiClient): SourceSummary[] {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    client
      .listSources()
      .then((data) => {
        if (!cancelled) setSources(data);
      })
      .catch(() => {
        // Roster is progress cosmetics only — the run itself will report.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);
  return sources;
}

const DEGRADED_STATUSES = new Set(['FAILED', 'BUDGET_EXCEEDED']);

/** "term · brand · qty · CEP" line above the results. */
function QuerySummary({
  request,
  t,
}: {
  request: ResearchRequestView;
  t: ResearchMessages;
}): JSX.Element {
  return (
    <Text variant="body" as="p" color="secondary" data-testid="research-query-summary">
      “{request.term}”{request.brand !== null ? ` · ${request.brand}` : ''} ·{' '}
      {t.historyQuantity(request.quantity)}
      {request.region !== null ? ` · CEP ${request.region}` : ''}
    </Text>
  );
}

/** Everything a COMPLETED run shows below the status rows. */
function CompletedOutcome({
  run,
  request,
  messages,
  t,
}: {
  run: ResearchRunView;
  request: ResearchRequestView;
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
  t: ResearchMessages;
}): JSX.Element {
  const best = run.offers[0];
  const degraded = run.sourceStats.some((stat) => DEGRADED_STATUSES.has(stat.status));
  return (
    <>
      {degraded && (
        <Alert
          variant="warning"
          title={t.degradedTitle}
          description={t.degradedBody}
          data-testid="research-degraded"
        />
      )}
      {best !== undefined && (
        <BestOfferCard offer={best} quantity={request.quantity} messages={messages} />
      )}
      {run.offers.length > 0 ? (
        <Stack spacing={1}>
          <Text variant="heading" as="h3" size="sm">
            {t.offersTitle}
          </Text>
          <OffersTable offers={run.offers} messages={messages} />
        </Stack>
      ) : (
        // EmptyState forwards no test id — the wrapper carries it.
        <div data-testid="research-no-offers">
          <EmptyState
            variant="minimal"
            title={t.offersEmptyTitle}
            description={t.offersEmptyBody}
          />
        </div>
      )}
    </>
  );
}

/**
 * A run still in flight: the pending line, plus whatever prices have already
 * landed (FUT-519) — the same table, in the same (final) order, over the
 * sources that have answered.
 *
 * NO `BestOfferCard` here, deliberately. The hero owns the only outbound CTA
 * on this screen, and ranking is cheapest-first across ALL sources — so a live
 * hero would re-point at a different store the moment a later source lands,
 * under a cursor already moving toward "Comprar na loja". The table can absorb
 * an insertion; a single-target call to action cannot.
 */
function PendingOutcome({
  phase,
  run,
  messages,
  t,
}: {
  phase: ResearchPhase;
  run: ResearchRunView | null;
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
  t: ResearchMessages;
}): JSX.Element {
  return (
    <>
      <Text variant="body" as="p" role="status" data-testid="research-run-pending">
        {phase === 'queued' ? t.runQueued : t.runRunning}
      </Text>
      {run !== null && run.offers.length > 0 && (
        <Stack spacing={1} data-testid="research-partial-offers">
          <Text variant="heading" as="h3" size="sm">
            {t.offersPartialTitle}
          </Text>
          <Text variant="caption" as="p" color="secondary">
            {t.offersPartialNote}
          </Text>
          <OffersTable offers={run.offers} messages={messages} />
        </Stack>
      )}
    </>
  );
}

/** The pane below the status rows, by phase. */
function RunOutcome({
  phase,
  run,
  request,
  messages,
  t,
}: {
  phase: ResearchPhase;
  run: ResearchRunView | null;
  request: ResearchRequestView | null;
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
  t: ResearchMessages;
}): JSX.Element | null {
  if (phase === 'queued' || phase === 'running') {
    return <PendingOutcome phase={phase} run={run} messages={messages} t={t} />;
  }
  if (phase === 'failed') {
    return (
      <Alert
        variant="danger"
        title={t.runFailedTitle}
        description={run?.error ?? ''}
        data-testid="research-run-failed"
      />
    );
  }
  if (run === null || request === null) return null;
  return <CompletedOutcome run={run} request={request} messages={messages} t={t} />;
}

export function ResearchRunScreen({
  client,
  requestId,
  runChannel,
  messages,
}: ResearchRunScreenProps): JSX.Element {
  const t = resolveMessages(messages);
  const sources = useSourceRoster(client);
  const { phase, request, run, sourceStats, error, reload } = useResearchRun(client, requestId, {
    channel: runChannel,
  });

  if (phase === 'loading') {
    return <LoadingState dataTestId="research-run-loading" />;
  }
  if (phase === 'error') {
    return (
      <Alert
        variant="danger"
        title={error ?? 'erro'}
        data-testid="research-run-error"
        onClick={reload}
      />
    );
  }

  const pending = phase === 'queued' || phase === 'running';
  return (
    <Stack spacing={3} data-testid="research-run-screen">
      {request !== null && <QuerySummary request={request} t={t} />}
      <SourceStatusList
        sources={sources}
        stats={sourceStats}
        running={pending}
        messages={messages}
      />
      <RunOutcome phase={phase} run={run} request={request} messages={messages} t={t} />
    </Stack>
  );
}
