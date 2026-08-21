import { useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type {
  ComparisonCellWire,
  ComparisonColumnWire,
  LifecycleApiClient,
  VersionComparisonWire,
} from './api';
import type { VersionComparisonCopy } from './copy';
import { DATE_TIME } from './labels';

/**
 * The version-comparison panel (FUT-247) — the selected version read SIDE BY
 * SIDE with its previous version, its next one, and the current one.
 *
 * The history list can only name the fields a version touched, because a
 * version row stores nothing else. This is the table that answers what those
 * fields actually SAID: one column per version, one row per field.
 *
 * Columns collapse rather than repeat. The newest version is both the
 * selection's `next` and the `current` record; a record with one version is
 * both `selected` and `current`. Each version is ONE column carrying every
 * role it plays, so a v1..v4 history compared at v3 shows three columns, not
 * four with a duplicate.
 *
 * WHICH ROWS: only the fields that differ, because that is the question the
 * panel is opened to answer — with two exceptions that keep it honest. A
 * record with a single version has nothing to differ from, so every field is
 * shown (the panel degenerates into "what this version says"); and when the
 * compared versions genuinely agree on everything, the panel says so rather
 * than rendering an empty table.
 */

const CELL_SX = {
  p: 1,
  borderBottom: (theme: { palette: { divider: string } }) =>
    `1px solid ${theme.palette.divider}`,
  verticalAlign: 'top',
  textAlign: 'left',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
} as const;

/**
 * One cell's value as text.
 *
 * The three empties are deliberately different words. A field the version does
 * not carry at all ("—") is not a field set to null ("vazio"), and neither is
 * the string "null" a user might have typed — collapsing them would make the
 * table lie about what changed. The boolean words are the host's.
 */
export function formatCellValue(cell: ComparisonCellWire, copy: VersionComparisonCopy): string {
  if (!cell.present) return '—';
  const { value } = cell;
  if (value === null) return 'vazio';
  if (typeof value === 'boolean') return value ? copy.booleanTrue : copy.booleanFalse;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value === '' ? 'vazio' : value;
  return JSON.stringify(value);
}

/** A column header: the version, what it is to the selection, and its stamp. */
function ColumnHeader({
  column,
  copy,
  systemActor,
}: {
  column: ComparisonColumnWire;
  copy: VersionComparisonCopy;
  systemActor: string;
}): JSX.Element {
  return (
    <Box
      component="th"
      scope="col"
      data-testid={`comparison-column-${column.version}`}
      sx={{ ...CELL_SX, minWidth: 140 }}
    >
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Text variant="heading" size="sm" as="span">
            {`v${column.version}`}
          </Text>
          {column.roles.map((role) =>
            role === 'selected' ? (
              <Chip key={role} label={copy.roles[role]} size="sm" color="primary" />
            ) : (
              <Chip key={role} label={copy.roles[role]} size="sm" variant="outlined" />
            ),
          )}
        </Stack>
        <Text variant="caption" as="span" color="secondary">
          {`${DATE_TIME.format(new Date(column.createdAt))} · ${column.actorName ?? systemActor}`}
        </Text>
      </Stack>
    </Box>
  );
}

/** One field across every column, marked when the columns disagree. */
function FieldRow({
  field,
  changed,
  cells,
  copy,
}: {
  field: string;
  changed: boolean;
  cells: ComparisonCellWire[];
  copy: VersionComparisonCopy;
}): JSX.Element {
  return (
    <Box component="tr" data-testid={`comparison-row-${field}`} data-changed={String(changed)}>
      <Box component="th" scope="row" sx={{ ...CELL_SX, fontWeight: 600 }}>
        {field}
      </Box>
      {cells.map((cell) => (
        <Box
          component="td"
          key={cell.version}
          data-testid={`comparison-cell-${field}-${cell.version}`}
          data-present={String(cell.present)}
          sx={{ ...CELL_SX, color: cell.present ? undefined : 'text.disabled' }}
        >
          {formatCellValue(cell, copy)}
        </Box>
      ))}
    </Box>
  );
}

/** The table itself, scrollable sideways so four columns never widen the dialog. */
function ComparisonTable({
  comparison,
  rows,
  copy,
  systemActor,
}: {
  comparison: VersionComparisonWire;
  rows: VersionComparisonWire['rows'];
  copy: VersionComparisonCopy;
  systemActor: string;
}): JSX.Element {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        data-testid="version-comparison-table"
        sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
      >
        <Box component="thead">
          <Box component="tr">
            <Box component="th" scope="col" sx={{ ...CELL_SX, minWidth: 120 }}>
              <Text variant="heading" size="sm" as="span">
                Campo
              </Text>
            </Box>
            {comparison.columns.map((column) => (
              <ColumnHeader
                key={column.version}
                column={column}
                copy={copy}
                systemActor={systemActor}
              />
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((row) => (
            <FieldRow
              key={row.field}
              field={row.field}
              changed={row.changed}
              cells={row.cells}
              copy={copy}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export interface VersionComparisonPanelProps {
  comparison: VersionComparisonWire;
  /** The host's words — pt-BR hosts pass `PT_BR_LIFECYCLE_WEB_COPY.comparison`. */
  copy: VersionComparisonCopy;
  /** Who acted when no user is recorded (`PT_BR_LIFECYCLE_WEB_COPY.systemActor`). */
  systemActor: string;
}

/** The panel a clicked history row opens: its version beside the neighbours. */
export function VersionComparisonPanel({
  comparison,
  copy,
  systemActor,
}: VersionComparisonPanelProps): JSX.Element {
  // One column means one version exists (or the neighbours all collapsed into
  // it): there is nothing to diff, so every field is shown instead of none.
  const lone = comparison.columns.length < 2;
  const rows = lone ? comparison.rows : comparison.rows.filter((row) => row.changed);

  return (
    <Stack spacing={1} data-testid="version-comparison">
      <Text variant="heading" size="sm" as="h3">
        {copy.heading(comparison.selectedVersion)}
      </Text>
      {lone && (
        <Alert
          variant="info"
          description={copy.singleVersionBody}
          data-testid="comparison-single"
        />
      )}
      {rows.length === 0 ? (
        <Text variant="body" as="p" data-testid="comparison-empty">
          {copy.noDifferences}
        </Text>
      ) : (
        <ComparisonTable comparison={comparison} rows={rows} copy={copy} systemActor={systemActor} />
      )}
    </Stack>
  );
}

interface ComparisonLoad {
  data: VersionComparisonWire | null;
  error: string | null;
}

/** Load the comparison for one version, re-fetching when the selection moves. */
function useComparison(
  api: LifecycleApiClient,
  resourcePath: string,
  version: number,
): ComparisonLoad {
  const [data, setData] = useState<VersionComparisonWire | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .compareVersion(resourcePath, version)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, resourcePath, version]);

  return { data, error };
}

export interface VersionComparisonSectionProps {
  api: LifecycleApiClient;
  /** Entity resource path under the mount, e.g. `products/${id}`. */
  resourcePath: string;
  /** The host's words — pt-BR hosts pass `PT_BR_LIFECYCLE_WEB_COPY.comparison`. */
  copy: VersionComparisonCopy;
  /** Who acted when no user is recorded (`PT_BR_LIFECYCLE_WEB_COPY.systemActor`). */
  systemActor: string;
  /** The version the admin clicked. */
  version: number;
}

/**
 * The panel with its own loading and failure states — what a clicked history
 * row renders. Split from {@link VersionComparisonPanel} so the panel itself
 * stays a pure function of a comparison (and testable as one).
 */
export function VersionComparisonSection({
  api,
  resourcePath,
  copy,
  systemActor,
  version,
}: VersionComparisonSectionProps): JSX.Element {
  const load = useComparison(api, resourcePath, version);

  if (load.error !== null) {
    return (
      <Alert
        variant="danger"
        description={copy.loadFailedBody}
        data-testid="version-comparison-error"
      />
    );
  }
  if (load.data === null) {
    return <LoadingState dataTestId="version-comparison-loading" />;
  }
  return <VersionComparisonPanel comparison={load.data} copy={copy} systemActor={systemActor} />;
}
