import type { JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { AuditLogWire, AuditSort } from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import { formatLabel, type AuditLabels } from './labels';

/**
 * The audit trail's rows — a plain table, split from the screen so both
 * stay inside the size gate. Read-only by construction: there is no affordance
 * here, because there is no endpoint that could act on an entry.
 *
 * The ACTOR cell is the interesting one. It renders the attribution PAIR as one
 * line naming BOTH people — "Ada on behalf of Brendan" — and never collapses them.
 * The viewer this was extracted from showed only the actor: its API had carried
 * `onBehalfOfUserId`/`onBehalfOfName` for two releases and the screen dropped them
 * on the floor, so a support session was indistinguishable on screen from the
 * store owner working alone. That is the exact fact the column pair exists to
 * keep, and losing it in the last five pixels of the pipeline wastes the whole
 * mechanism behind it.
 */

const CELL = { p: 1, verticalAlign: 'top' } as const;

/** Compact "field: before → after" summary of the redacted diff. */
export function formatDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .map((key) => {
      const was = before[key];
      const now = after[key];
      if (was === undefined) return `${key}: ${String(now)}`;
      if (now === undefined) return `${key}: ${String(was)}`;
      return `${key}: ${String(was)} → ${String(now)}`;
    })
    .join(' · ');
}

/** "Who · under which role", or the system label for an actorless entry. */
function actorText(entry: AuditLogWire, labels: AuditLabels): string {
  if (!entry.actorUserId) return labels.systemActor;
  const name = entry.actorName ?? labels.unknownActor;
  return entry.actorRole ? `${name} · ${entry.actorRole}` : name;
}

/** The impersonated subject's line, or `null` for an ordinary entry. */
function onBehalfOfText(entry: AuditLogWire, labels: AuditLabels): string | null {
  if (!entry.onBehalfOfUserId) return null;
  return formatLabel(labels.onBehalfOf, {
    actor: entry.actorUserId ? (entry.actorName ?? labels.unknownActor) : labels.systemActor,
    subject: entry.onBehalfOfName ?? labels.unknownActor,
  });
}

function ActorCell({
  entry,
  labels,
}: {
  entry: AuditLogWire;
  labels: AuditLabels;
}): JSX.Element {
  const onBehalfOf = onBehalfOfText(entry, labels);
  return (
    <Stack spacing={0.25}>
      <Text variant="body" as="span" data-testid={`audit-log-actor-${entry.id}`}>
        {actorText(entry, labels)}
      </Text>
      {onBehalfOf ? (
        <Text variant="caption" as="span" data-testid={`audit-log-on-behalf-of-${entry.id}`}>
          {onBehalfOf}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * The date column's header: the ONE sortable axis, as a toggle.
 *
 * `createdAt` is the only field a trail can be ordered by (see {@link AuditSort}),
 * and "oldest first" is a real reading of it — a dispute is reconstructed
 * forwards. The arrow states which way it is pointing now, so the control says
 * what it will do rather than what it just did.
 */
function DateHeader({
  labels,
  sort,
  onSortChange,
}: {
  labels: AuditLabels;
  sort: AuditSort;
  onSortChange: (next: AuditSort) => void;
}): JSX.Element {
  const ascending = sort === 'createdAt:asc';
  return (
    <Button
      variant="text"
      size="sm"
      aria-label={labels.sortByDate}
      dataTestId="audit-log-sort-date"
      onClick={() => onSortChange(ascending ? 'createdAt:desc' : 'createdAt:asc')}
    >
      {`${labels.columnDate} ${ascending ? '↑' : '↓'}`}
    </Button>
  );
}

export interface AuditEntriesTableProps {
  entries: readonly AuditLogWire[];
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  /** Stamp formatter — the host's locale, defaulting to the runtime's. */
  formatDate: (iso: string) => string;
  /** The order in force, and the way to change it. */
  sort: AuditSort;
  onSortChange: (next: AuditSort) => void;
}

export function AuditEntriesTable({
  entries,
  labels,
  vocabulary,
  formatDate,
  sort,
  onSortChange,
}: AuditEntriesTableProps): JSX.Element {
  return (
    <Box
      component="table"
      data-testid="audit-log-grid"
      sx={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <Box component="thead">
        <Box component="tr">
          <Box component="th" sx={{ ...CELL, textAlign: 'left' }}>
            <DateHeader labels={labels} sort={sort} onSortChange={onSortChange} />
          </Box>
          {[
            labels.columnActor,
            labels.columnAction,
            labels.columnResource,
            labels.columnResourceId,
            labels.columnChange,
          ].map((header) => (
            <Box component="th" key={header} sx={{ ...CELL, textAlign: 'left' }}>
              <Text variant="caption" as="span">
                {header}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
      <Box component="tbody">
        {entries.map((entry) => (
          <Box component="tr" key={entry.id} data-testid={`audit-log-row-${entry.id}`}>
            <Box component="td" sx={CELL}>
              <Text variant="body" as="span">
                {formatDate(entry.createdAt)}
              </Text>
            </Box>
            <Box component="td" sx={CELL}>
              <ActorCell entry={entry} labels={labels} />
            </Box>
            <Box component="td" sx={CELL}>
              <Text variant="body" as="span">
                {vocabulary.actionLabel(entry.action)}
              </Text>
            </Box>
            <Box component="td" sx={CELL}>
              <Text variant="body" as="span">
                {vocabulary.resourceLabel(entry.resourceType)}
              </Text>
            </Box>
            <Box component="td" sx={CELL}>
              <Text variant="caption" as="span">
                {entry.resourceId}
              </Text>
            </Box>
            <Box component="td" sx={CELL}>
              <Text variant="caption" as="span">
                {formatDiff(entry.before, entry.after)}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
