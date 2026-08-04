'use client';

/**
 * Per-source progress rows. While the run is in flight the enabled roster is
 * the row list and each row resolves the moment ITS stat is known (FUT-439 —
 * streamed per source, or read from the run's partial stats), the rest
 * showing "consultando…"; once the run finishes the run's own stat list is
 * the truth. Failures and budget caps stay loud, because a silently shorter
 * offer list is the one thing this screen must never produce.
 *
 * Loud now means SPECIFIC (FUT-495): a failed source shows the reason the
 * connector recorded — "a loja recusou nosso acesso (HTTP 403 — bloqueio de bot
 * ou de IP)" — truncated to fit the row, with the full text in the chip's
 * accessible description. "indisponível" alone sent a real tenant's dead
 * Atacadão source unnoticed for a day.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { CaveatChip } from './caveat-chip';
import { redactQueryStrings, truncateForRow } from './format';
import { resolveMessages, type ResearchMessages } from './messages';
import type { SourceStatView, SourceSummary } from './types';

export interface SourceStatusListProps {
  /** The configured roster — the rows shown before stats exist. */
  sources: SourceSummary[];
  /**
   * Per-source outcomes known so far — partial while the run streams
   * (FUT-439), the run's complete list once it finished.
   */
  stats: SourceStatView[] | null;
  running: boolean;
  messages?: Partial<ResearchMessages>;
}

/** Long enough to read a reason at a glance, short enough for a chip row. */
const REASON_ROW_MAX = 96;

/**
 * Ceiling on the FULL reason — the tooltip and the announced description
 * (FUT-517). Generous enough that every reason a connector composes today
 * arrives whole (the longest, the VTEX catalog sentence plus its endpoint, is
 * under 200 characters), so this bounds only what should never have been
 * stored.
 *
 * Same argument as `redactQueryStrings` next door: the connector now bounds at
 * write time, and the UI bounds AGAIN at render time, because a stored reason
 * is free text this package must not trust — and rows written before FUT-517
 * (which echoed the vendor's error body unbounded, an HTML error page included)
 * are exactly the input this pass exists for.
 */
const REASON_HINT_MAX = 400;

/**
 * Which caveat an answered source carries, or `null` for a plain OK.
 *
 * PRECEDENCE, when a source is both outside-area and truncated: outside-area
 * WINS. It is a claim about the price the buyer is looking at — this money may
 * not be reachable from your CEP — while truncation is a claim about the list
 * around it. One chip has room for one sentence, and the buyer must read the
 * one that can cost them an order. A truncated VTEX answer skips the delivery
 * check entirely, so the two rarely coincide in the first place.
 */
type AnswerCaveat = 'outside-area' | 'truncated';

const answerCaveat = (stat: SourceStatView): AnswerCaveat | null => {
  if (stat.outsideDeliveryArea === true) return 'outside-area';
  return stat.truncated === true ? 'truncated' : null;
};

/**
 * The count label of a source that answered — spelling out "outra região" when
 * the prices came from the store's default region (FUT-491) and "busca
 * interrompida" when the per-source ceiling cut the search (FUT-516), so
 * neither can ever be mistaken for a plain, complete, local OK.
 */
function answeredLabel(
  stat: SourceStatView,
  t: ResearchMessages,
  caveat: AnswerCaveat | null,
): string {
  const cached = stat.status === 'CACHED';
  if (caveat === 'outside-area') {
    return cached
      ? t.statusCachedOutsideArea(stat.offerCount)
      : t.statusOkOutsideArea(stat.offerCount);
  }
  if (caveat === 'truncated') {
    return cached ? t.statusCachedTruncated(stat.offerCount) : t.statusOkTruncated(stat.offerCount);
  }
  return cached ? t.statusCached(stat.offerCount) : t.statusOk(stat.offerCount);
}

/**
 * What a settled row says beyond its status chip: the stored reason of a source
 * that failed or was capped, query strings redacted (a source URL can carry a
 * key, and this text is rendered). `null` = nothing to add.
 */
function statReason(stat: SourceStatView, t: ResearchMessages): string | null {
  if (stat.status !== 'FAILED' && stat.status !== 'BUDGET_EXCEEDED') return null;
  const recorded = redactQueryStrings(stat.error ?? '').trim();
  if (recorded.length > 0) return recorded;
  // A cap explains itself through its own chip; a FAILURE with no reason at all
  // must still say so rather than leaving the operator with one adjective.
  return stat.status === 'FAILED' ? t.statusReasonUnknown : null;
}

/**
 * The chip a source that ANSWERED gets. A source that fell back to its default
 * region — or that we cut short — succeeded, so the status union is untouched:
 * both caveats are flags on the stat, rendered through the chip FUT-495 built
 * for reachable (hover, keyboard AND screen-reader) explanations.
 */
function answeredChip(stat: SourceStatView, t: ResearchMessages): JSX.Element {
  const caveat = answerCaveat(stat);
  const label = answeredLabel(stat, t, caveat);
  if (caveat === null) {
    return <Chip label={label} size="small" variant="outlined" color="success" />;
  }
  const outsideArea = caveat === 'outside-area';
  return (
    <CaveatChip
      label={label}
      hint={outsideArea ? t.outsideAreaHint : t.truncatedHint}
      dataTestId={
        outsideArea
          ? `source-status-outside-area-${stat.sourceId}`
          : `source-status-truncated-${stat.sourceId}`
      }
    />
  );
}

function statChip(stat: SourceStatView, t: ResearchMessages, reason: string | null): JSX.Element {
  if (stat.status === 'OK' || stat.status === 'CACHED') return answeredChip(stat, t);
  if (stat.status === 'SKIPPED') {
    return <Chip label={t.statusSkipped} size="small" variant="outlined" />;
  }
  const failed = stat.status === 'FAILED';
  const label = failed ? t.statusFailed : t.statusBudget;
  if (reason === null) {
    return <Chip label={label} size="small" variant="outlined" color={failed ? 'error' : 'warning'} />;
  }
  // The reason in full (up to REASON_HINT_MAX) lives here — the row line below
  // is truncated much harder, for layout.
  return (
    <CaveatChip
      label={label}
      hint={t.statusFailureReason(reason)}
      color={failed ? 'error' : 'warning'}
      dataTestId={`source-status-why-${stat.sourceId}`}
    />
  );
}

interface SourceStatusRow {
  key: string;
  name: string;
  stat: SourceStatView | null;
}

/**
 * Once the run FINISHED, its stat list is the truth (a source added
 * mid-flight was not part of this run). While it is in flight, the enabled
 * roster is the row list and every stat already known resolves its row —
 * source-by-source, without waiting for the slowest one.
 */
function buildRows(
  sources: SourceSummary[],
  stats: SourceStatView[] | null,
  running: boolean,
): SourceStatusRow[] {
  const settled = stats ?? [];
  const statRows = settled.map((stat) => ({ key: stat.sourceId, name: stat.name, stat }));
  if (!running && stats !== null) return statRows;
  const roster = sources.filter((source) => source.enabled);
  // No roster to overlay (its read failed or nothing is enabled): whatever
  // already settled still shows rather than nothing.
  if (roster.length === 0) return statRows;
  const bySource = new Map(settled.map((stat) => [stat.sourceId, stat]));
  return roster.map((source) => ({
    key: source.id,
    name: source.name,
    stat: bySource.get(source.id) ?? null,
  }));
}

function SourceStatusRowView({
  row,
  t,
  running,
}: {
  row: SourceStatusRow;
  t: ResearchMessages;
  running: boolean;
}): JSX.Element {
  const recorded = row.stat === null ? null : statReason(row.stat, t);
  // Bounded once, for both surfaces: the chip's description gets the whole
  // reason up to the ceiling, the row line truncates that further to fit.
  const reason = recorded === null ? null : truncateForRow(recorded, REASON_HINT_MAX);
  return (
    <Stack spacing={0.25} data-testid={`source-status-${row.key}`}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Text variant="body" as="span" size="sm">
          {row.name}
        </Text>
        {row.stat !== null ? (
          statChip(row.stat, t, reason)
        ) : (
          <Chip label={running ? t.statusQuerying : '…'} size="small" variant="outlined" />
        )}
      </Stack>
      {reason !== null && (
        <Text
          variant="caption"
          as="p"
          color="secondary"
          data-testid={`source-status-reason-${row.key}`}
        >
          {t.statusFailureReason(truncateForRow(reason, REASON_ROW_MAX))}
        </Text>
      )}
    </Stack>
  );
}

export function SourceStatusList({
  sources,
  stats,
  running,
  messages,
}: SourceStatusListProps): JSX.Element {
  const t = resolveMessages(messages);
  const rows = buildRows(sources, stats, running);

  return (
    <Stack spacing={0.5} data-testid="source-status-list">
      <Text variant="caption" as="p" color="secondary">
        {t.statusTitle}
      </Text>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {rows.map((row) => (
          <SourceStatusRowView key={row.key} row={row} t={t} running={running} />
        ))}
      </Stack>
    </Stack>
  );
}
