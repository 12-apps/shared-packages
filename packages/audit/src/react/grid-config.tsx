/**
 * The trail as a `DataViews` grid: its columns, its filter pills, its period
 * range and its one sortable axis.
 *
 * WHY THE SHARED GRID AND NOT THE BAR THIS REPLACES. The viewer used to ship a
 * hand-rolled filter bar — toggle chips in a wrapped row, a native `<select>`
 * for the actor, two masked day fields — on the argument that a host with a
 * non-MUI design system still has to render that part, so it should stay as
 * plain as the behaviour allows. The argument held while the controls were the
 * only ones on the screen. It stopped holding once every OTHER list in an
 * adopting host ran on `@12-apps/ui`'s grid: the trail then had a different
 * search box, a different way to pick a value, no column control, no saved
 * views, no view switcher and a pager that said something else — in a product
 * where an operator moves between those lists all day. A filter surface is
 * learned once and reused; being the one screen that works differently is a
 * bigger portability cost than the dependency, and `@12-apps/ui` was already a
 * dependency of this package.
 *
 * What stays true is the part that mattered: nothing here is a word. Every
 * label is the host's `AuditLabels` or the host's `AuditVocabulary`, and the
 * grid's own chrome is the host's `DataViewsCopy`.
 */
import type { JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import type {
  DataViewColumn,
  DataViewQuery,
  DataViewState,
  FilterFieldConfig,
  RangeFieldConfig,
} from '@12-apps/ui/data-display/DataViews';
import type { ExportColumn } from '@12-apps/ui/utils';

import {
  DEFAULT_AUDIT_SORT,
  type AuditActorOptionWire,
  type AuditLogFilters,
  type AuditSort,
} from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import type { AuditRow } from './grid-rows';
import type { AuditLabels } from './labels';

/**
 * The grid's own ids for the things a saved view, the URL and the query all
 * address by name.
 *
 * Named once because they are a CONTRACT between four places that never see
 * each other: the field config, the query mapping, the initial state and the
 * host's URL keys. A string typed twice is the drift this package has already
 * paid for in its label maps.
 */
export const AUDIT_FIELD = {
  action: 'action',
  resource: 'resourceType',
  actor: 'actorUserId',
} as const;

/** The period range pill's id — the key under `DataViewState.ranges`. */
export const AUDIT_RANGE_PERIOD = 'period';

/** The sortable column's id. `createdAt` is the trail's only meaningful axis. */
export const AUDIT_SORT_COLUMN = 'date';

/**
 * The ACTOR cell: the attribution pair, as two lines naming both people.
 *
 * A `cell` renderer rather than a plain accessor because this is the one column
 * whose value is two facts. Both are on the row already (see `grid-rows.ts`),
 * so the search scan and the export still reach them through `accessor`.
 */
function ActorCell({ row }: { row: AuditRow }): JSX.Element {
  return (
    <Stack spacing={0.25}>
      <Text variant="body" as="span" data-testid={`audit-log-actor-${row.id}`}>
        {row.actorLabel}
      </Text>
      {row.onBehalfOfLabel ? (
        <Text variant="caption" as="span" data-testid={`audit-log-on-behalf-of-${row.id}`}>
          {row.onBehalfOfLabel}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * The trail's columns.
 *
 * Only the date sorts. That is a property of the data rather than an omission:
 * an append-only trail has exactly one meaningful axis, and every other column
 * is a repeated categorical value that would sort rows into an order no reader
 * could page through.
 */
export function auditColumns(labels: AuditLabels): DataViewColumn<AuditRow>[] {
  return [
    {
      id: AUDIT_SORT_COLUMN,
      header: labels.columnDate,
      accessor: (row) => row.dateLabel,
      // Never hidden: a trail row with no stamp is not evidence of anything.
      hideable: false,
    },
    {
      id: 'actor',
      header: labels.columnActor,
      enableSort: false,
      // Both halves of the pair, so "who did the screen claim to be" is
      // searchable and exportable and not only visible.
      accessor: (row) =>
        row.onBehalfOfLabel ? `${row.actorLabel} ${row.onBehalfOfLabel}` : row.actorLabel,
      searchable: true,
      cell: ({ row }) => <ActorCell row={row} />,
    },
    {
      id: 'action',
      header: labels.columnAction,
      enableSort: false,
      accessor: (row) => row.actionLabel,
    },
    {
      id: 'resource',
      header: labels.columnResource,
      enableSort: false,
      accessor: (row) => row.resourceLabel,
    },
    {
      id: 'resourceId',
      header: labels.columnResourceId,
      enableSort: false,
      accessor: (row) => row.resourceId,
      searchable: true,
    },
    {
      id: 'change',
      header: labels.columnChange,
      enableSort: false,
      accessor: (row) => row.changeLabel,
    },
  ];
}

/**
 * The filter pills: action, resource and actor.
 *
 * The action and resource options are built from the vocabulary's OWN id order
 * and its own label lookup — the same two things the server's filter enum is
 * built from — so a pill this screen offers is a value that endpoint accepts.
 * That property is #924's, and it is the reason the options are not derived
 * from the loaded page: a page of twenty rows knows about the actions it
 * happens to contain, which is precisely the wrong list to filter by.
 *
 * The ACTOR field is offered only when the host wired a directory. With no
 * roster there is nothing to pick from, and a pill whose menu is empty reads as
 * a broken filter rather than an absent one — the free-text fallback the old
 * bar carried is served instead by the search box, which already matches ids.
 */
export function auditFields(
  labels: AuditLabels,
  vocabulary: AuditVocabulary,
  actors: readonly AuditActorOptionWire[],
  locale?: string,
): FilterFieldConfig<AuditRow>[] {
  const fields: FilterFieldConfig<AuditRow>[] = [
    {
      id: AUDIT_FIELD.action,
      label: labels.filterAction,
      // A searchable dropdown, not a row of checkboxes: this list grows with
      // every action a host's writers can emit (thirty-odd in the origin
      // host), and a closed enum it is not.
      control: 'multiselect',
      searchEnabled: true,
      accessor: (row) => row.action,
      options: vocabulary.actionIds.map((id) => ({
        value: id,
        label: vocabulary.actionLabel(id, { locale }),
      })),
    },
    {
      id: AUDIT_FIELD.resource,
      label: labels.filterResource,
      accessor: (row) => row.resourceType,
      options: vocabulary.resourceIds.map((id) => ({
        value: id,
        label: vocabulary.resourceLabel(id, { locale }),
      })),
    },
  ];
  if (actors.length > 0) {
    fields.push({
      id: AUDIT_FIELD.actor,
      label: labels.filterActor,
      control: 'multiselect',
      // A tenant's roster is unbounded and its members are people, which is
      // the one option set a reader scans by typing a name.
      searchEnabled: true,
      accessor: (row) => row.actorUserId,
      options: actors.map((actor) => ({ value: actor.id, label: actor.label })),
    });
  }
  return fields;
}

/**
 * The day window, as the grid's own range pill.
 *
 * Being a real `rangeField` is what puts it in `DataViewState`: the saved view,
 * the grid's "Limpar filtros" and the presets (Hoje / Ontem / Esta semana / …)
 * all reach it with no plumbing here, and the pill sits in the same row as the
 * other filters instead of beside them as two loose fields.
 *
 * It also retires this package's masked day inputs. They existed because a
 * native date input renders in the BROWSER's locale rather than the surface's,
 * and because a controlled one cannot survive a URL-mirroring host's commit
 * latency — both real, and both now answered inside the grid's day input,
 * which every other list in an adopting host already types dates into.
 *
 * The accessor serves the client-side matcher only: this grid runs in server
 * mode, where the database applies the window. A correct one keeps the config
 * honest for a host that renders it without a `server` prop.
 */
export function auditRangeFields(labels: AuditLabels): RangeFieldConfig<AuditRow>[] {
  return [
    {
      id: AUDIT_RANGE_PERIOD,
      label: labels.filterPeriod,
      kind: 'day',
      accessor: (row) => row.createdDay,
    },
  ];
}

/** The CSV/JSON export — the columns the grid shows, in the same order. */
export function auditExportColumns(labels: AuditLabels): ExportColumn<AuditRow>[] {
  return [
    { header: labels.columnDate, value: (row) => row.dateLabel },
    { header: labels.columnActor, value: (row) => row.actorLabel },
    // Its own column in the download rather than a suffix: a spreadsheet is
    // filtered and pivoted, and "which rows happened during a support session"
    // is a question only a separate column can answer.
    { header: labels.columnOnBehalfOf, value: (row) => row.onBehalfOfLabel ?? '' },
    { header: labels.columnAction, value: (row) => row.actionLabel },
    { header: labels.columnResource, value: (row) => row.resourceLabel },
    { header: labels.columnResourceId, value: (row) => row.resourceId },
    { header: labels.columnChange, value: (row) => row.changeLabel },
  ];
}

/** The grid's sort dropdown: one field, because the trail has one axis. */
export function auditSortFields(labels: AuditLabels): { value: string; label: string }[] {
  return [{ value: AUDIT_SORT_COLUMN, label: labels.columnDate }];
}

/** A pill selection, or nothing when it is absent or empty. */
const pill = (values: string[] | undefined): string[] | undefined =>
  values && values.length > 0 ? values : undefined;

/** A range bound as the endpoint's `YYYY-MM-DD`, or nothing. */
const bound = (value: number | string | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * The grid's query → the endpoint's filters.
 *
 * `page` is deliberately NOT defaulted away here: the grid emits the page it is
 * on, and the viewer decides whether a change resets it (a filter change does,
 * a page click does not). Encoding that rule twice is how the two disagree.
 */
export function filtersFromQuery(query: DataViewQuery): AuditLogFilters {
  const period = query.ranges[AUDIT_RANGE_PERIOD] ?? {};
  const sort = query.sortBy[0];
  const filters: AuditLogFilters = {
    q: query.search || undefined,
    actionIn: pill(query.pills[AUDIT_FIELD.action]),
    resourceTypeIn: pill(query.pills[AUDIT_FIELD.resource]),
    // The endpoint matches ONE actor, and the pill is a multiselect like every
    // other one in this grid — so a selection of several narrows to the first
    // rather than silently dropping the filter. Picking two actors is a
    // question this endpoint cannot answer; answering with one of them is
    // closer to the ask than answering with everybody.
    actorUserId: pill(query.pills[AUDIT_FIELD.actor])?.[0],
    from: bound(period.min),
    to: bound(period.max),
    sort: sort?.dir === 'asc' ? 'createdAt:asc' : undefined,
    page: query.page > 1 ? query.page : undefined,
  };
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as AuditLogFilters;
}

/** The pill selections a filter set puts back on the bar. */
function pillsFromFilters(filters: AuditLogFilters): Record<string, string[]> {
  const pills: Record<string, string[]> = {};
  if (filters.actionIn?.length) pills[AUDIT_FIELD.action] = filters.actionIn;
  if (filters.resourceTypeIn?.length) pills[AUDIT_FIELD.resource] = filters.resourceTypeIn;
  if (filters.actorUserId) pills[AUDIT_FIELD.actor] = [filters.actorUserId];
  return pills;
}

/** The period pill's window, or no ranges at all for an unbounded filter set. */
function rangesFromFilters(filters: AuditLogFilters): DataViewState['ranges'] {
  const period = {
    ...(filters.from ? { min: filters.from } : {}),
    ...(filters.to ? { max: filters.to } : {}),
  };
  return Object.keys(period).length > 0 ? { [AUDIT_RANGE_PERIOD]: period } : {};
}

/** The order in force for a filter set. */
const auditSort = (filters: AuditLogFilters): AuditSort => filters.sort ?? DEFAULT_AUDIT_SORT;

/** The endpoint's filters → the grid's seed state (the reverse mapping). */
export function stateFromFilters(filters: AuditLogFilters): DataViewState {
  return {
    search: filters.q ?? '',
    pills: pillsFromFilters(filters),
    ranges: rangesFromFilters(filters),
    sortBy: [
      { id: AUDIT_SORT_COLUMN, dir: auditSort(filters) === 'createdAt:asc' ? 'asc' : 'desc' },
    ],
    visibleColumns: [],
  };
}
