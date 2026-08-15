import { useState, type JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Input } from '@12-apps/ui/form/Input';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { AuditActorOptionWire, AuditLogFilters } from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import { DayBound, type DayFormat, type DaySegment } from './day-bound';
import { formatLabel, type AuditLabels } from './labels';

/**
 * The viewer's filter bar: the resource-id search, the action and
 * resource pills, the actor picker and the inclusive day bounds — the four
 * filters the endpoint accepts, and nothing the endpoint cannot serve.
 *
 * Pills are TOGGLES rather than a dropdown multiselect, and the actor picker is a
 * native `<select>`: this bar is the one part of the surface a host with a
 * non-MUI design system still has to render, so the controls stay as plain as the
 * behaviour allows (the payments "two design systems" proof is the precedent).
 *
 * The day bounds are the ONE control here that is not the plainest thing that
 * could work: they are masked text fields rather than `<input type="date">`,
 * because a controlled native date input cannot survive the commit latency a
 * URL-mirroring host introduces, and renders in a locale the surface does not
 * choose. Both reasons, with the measurement, are in `day-bound.tsx`.
 */

/** Add or remove one value from a pill filter, preserving declaration order. */
function toggle(values: readonly string[] | undefined, value: string, order: readonly string[]) {
  const current = new Set(values ?? []);
  if (current.has(value)) current.delete(value);
  else current.add(value);
  return order.filter((candidate) => current.has(candidate));
}

interface PillGroupProps {
  label: string;
  testIdPrefix: string;
  options: readonly { id: string; label: string }[];
  selected: readonly string[] | undefined;
  onToggle: (id: string) => void;
}

function PillGroup({
  label,
  testIdPrefix,
  options,
  selected,
  onToggle,
}: PillGroupProps): JSX.Element {
  const active = new Set(selected ?? []);
  return (
    <Stack spacing={0.5}>
      <Text variant="caption" as="span">
        {label}
      </Text>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {options.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selectable
            selected={active.has(option.id)}
            variant={active.has(option.id) ? 'filled' : 'outlined'}
            dataTestId={`${testIdPrefix}-${option.id}`}
            onClick={() => onToggle(option.id)}
          />
        ))}
      </Stack>
    </Stack>
  );
}

export interface AuditFilterBarProps {
  filters: AuditLogFilters;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  actors: readonly AuditActorOptionWire[];
  /** The locale's date order — see `day-bound.tsx`. */
  dayFormat: DayFormat;
  /** Applies a filter change and resets to page 1 (the screen owns that rule). */
  onChange: (next: AuditLogFilters) => void;
}

/** The placeholder's letters, in the host's words. */
const segmentNames = (labels: AuditLabels): Readonly<Record<DaySegment, string>> => ({
  day: labels.dayPlaceholderDay,
  month: labels.dayPlaceholderMonth,
  year: labels.dayPlaceholderYear,
});

/** The free-text box: typing is local, Enter commits (the house affordance). */
function SearchBox({
  labels,
  value,
  onCommit,
}: {
  labels: AuditLabels;
  value: string;
  onCommit: (keyword: string) => void;
}): JSX.Element {
  const [keyword, setKeyword] = useState(value);
  return (
    <Input
      fullWidth
      type="search"
      placeholder={labels.searchPlaceholder}
      aria-label={labels.searchPlaceholder}
      value={keyword}
      data-testid="audit-log-search"
      onChange={(event) => setKeyword(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(keyword);
      }}
    />
  );
}

function ActorPicker({
  labels,
  actors,
  value,
  onChange,
}: {
  labels: AuditLabels;
  actors: readonly AuditActorOptionWire[];
  value: string | undefined;
  onChange: (actorUserId: string | undefined) => void;
}): JSX.Element {
  // No directory wired on the host → no roster to offer, so the filter degrades
  // to the id itself rather than disappearing: an operator pasting an actor id
  // out of another system is exactly who still needs it.
  if (actors.length === 0) {
    return (
      <Input
        label={labels.filterActor}
        aria-label={labels.filterActor}
        value={value ?? ''}
        data-testid="audit-log-actor-id"
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  }
  return (
    <Stack spacing={0.5}>
      <Text variant="caption" as="span">
        {labels.filterActor}
      </Text>
      <Box
        component="select"
        aria-label={labels.filterActor}
        data-testid="audit-log-actor-select"
        value={value ?? ''}
        onChange={(event: { target: { value: string } }) =>
          onChange(event.target.value || undefined)
        }
        sx={{ p: 1, minWidth: 200 }}
      >
        <option value="">{labels.actorAny}</option>
        {actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.label}
          </option>
        ))}
      </Box>
    </Stack>
  );
}

export function AuditFilterBar({
  filters,
  labels,
  vocabulary,
  actors,
  dayFormat,
  onChange,
}: AuditFilterBarProps): JSX.Element {
  const names = segmentNames(labels);
  // Built from the vocabulary's OWN id order and its own label lookup — the
  // same two things the server's filter enum is built from, so a pill this
  // screen offers is a value that endpoint accepts.
  const actionOptions = vocabulary.actionIds.map((id) => ({
    id,
    label: vocabulary.actionLabel(id),
  }));
  const resourceOptions = vocabulary.resourceIds.map((id) => ({
    id,
    label: vocabulary.resourceLabel(id),
  }));
  return (
    <Stack spacing={1.5} data-testid="audit-log-filters">
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-end">
        <SearchBox
          labels={labels}
          value={filters.q ?? ''}
          onCommit={(keyword) => onChange({ ...filters, q: keyword || undefined })}
        />
        <ActorPicker
          labels={labels}
          actors={actors}
          value={filters.actorUserId}
          onChange={(actorUserId) => onChange({ ...filters, actorUserId })}
        />
        <DayBound
          label={labels.filterFrom}
          value={filters.from ?? ''}
          segmentNames={names}
          clearLabel={formatLabel(labels.clearBound, { field: labels.filterFrom })}
          format={dayFormat}
          testId="audit-log-from"
          onCommit={(from) => onChange({ ...filters, from })}
        />
        <DayBound
          label={labels.filterTo}
          value={filters.to ?? ''}
          segmentNames={names}
          clearLabel={formatLabel(labels.clearBound, { field: labels.filterTo })}
          format={dayFormat}
          testId="audit-log-to"
          onCommit={(to) => onChange({ ...filters, to })}
        />
        <Button variant="text" dataTestId="audit-log-clear" onClick={() => onChange({})}>
          {labels.clearFilters}
        </Button>
      </Stack>
      <PillGroup
        label={labels.filterAction}
        testIdPrefix="audit-log-action"
        options={actionOptions}
        selected={filters.actionIn}
        onToggle={(id) =>
          onChange({ ...filters, actionIn: toggle(filters.actionIn, id, vocabulary.actionIds) })
        }
      />
      <PillGroup
        label={labels.filterResource}
        testIdPrefix="audit-log-resource"
        options={resourceOptions}
        selected={filters.resourceTypeIn}
        onToggle={(id) =>
          onChange({
            ...filters,
            resourceTypeIn: toggle(filters.resourceTypeIn, id, vocabulary.resourceIds),
          })
        }
      />
    </Stack>
  );
}
