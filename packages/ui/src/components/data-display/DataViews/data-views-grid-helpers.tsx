"use client";

import { useDataViewsCopy } from "./data-views-copy-context";
import { type GridColumn } from "../DataGrid";
import { type SortFieldDefinition } from "../../layout/ContentToolbar";
import { Box } from "../../../mui/Box";
import { Button } from "../../form/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../navigation/DropdownMenu";

import type {
  DataViewColumn,
  DataViewState,
  FilterFieldConfig,
  RangeFieldConfig,
  RowAction,
} from "./data-views-types";

/** Is this the non-clickable actions column? */
export function isActionsColumn<T extends Record<string, unknown>>(col: GridColumn<T>): boolean {
  return col.type === "actions" || col.id === "actions";
}

/**
 * Map the DataView columns to grid columns, applying visibility and — when a row
 * click handler is present — wrapping each non-actions cell so clicking opens the row.
 */
export function buildGridColumns<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
  visibleColumns: string[],
  onRowClick: ((row: T) => void) | undefined,
): GridColumn<T>[] {
  return columns.map((col) => {
    const hidden = col.hideable !== false && !visibleColumns.includes(col.id);
    if (!onRowClick || isActionsColumn(col)) return { ...col, hidden };
    return {
      ...col,
      hidden,
      cell: (ctx) => {
        const content = col.cell ? col.cell(ctx) : ctx.value == null ? "" : String(ctx.value);
        return (
          <Box
            onClick={() => onRowClick(ctx.row)}
            sx={{ cursor: "pointer", width: "100%", height: "100%", display: "flex", alignItems: "center" }}
          >
            {content}
          </Box>
        );
      },
    };
  });
}

interface ActionsColumnConfig<T extends Record<string, unknown>> {
  /** Actions that build the auto "⋮" kebab. Ignored when `renderRowMenu` is set. */
  rowActions: RowAction<T>[];
  /** Optional leading slot (e.g. a favourite star) rendered before the kebab. */
  leading?: (row: T) => React.ReactNode;
  testIdPrefix: string;
  getRowId: (row: T) => string | number;
  /**
   * Escape hatch: render a bespoke per-row menu (e.g. an entity's self-contained
   * 3-dots menu that owns its own popups) INSTEAD of the auto kebab built from
   * `rowActions`. This is how the table row and the card share ONE menu component.
   * `rowActions`/`bulkActions` still drive the multi-row bulk menu, which a
   * single-row menu intentionally does not replace.
   */
  renderRowMenu?: (row: T) => React.ReactNode;
}

/**
 * The auto "⋮" kebab actions column built from the reusable `rowActions` — the
 * SAME definitions that feed the bulk menu, so the two never drift. Each item
 * acts on just this row; `rowLabel` provides a per-row label when set. An
 * optional `leading` slot (e.g. a favourite star) renders before the kebab.
 * When `renderRowMenu` is supplied, the cell renders that bespoke menu instead.
 */
export function buildRowActionsColumn<T extends Record<string, unknown>>(
  config: ActionsColumnConfig<T>,
): DataViewColumn<T> {
  const { rowActions, leading, testIdPrefix, getRowId, renderRowMenu } = config;
  const kebabActions = rowActions.filter((action) => action.row !== false);
  return {
    id: "actions",
    header: "",
    type: "actions",
    enableSort: false,
    hideable: false,
    // Narrow: the column only holds the "⋮" kebab (plus an optional leading icon),
    // so it needs room for just one or two icons.
    width: leading ? 72 : 44,
    cell: ({ row }) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
        {leading?.(row)}
        {renderRowMenu
          ? renderRowMenu(row)
          : renderAutoKebab(kebabActions, row, testIdPrefix, getRowId)}
      </span>
    ),
  };
}

/** The built-in kebab menu for one row, derived from `rowActions`. */
function renderAutoKebab<T extends Record<string, unknown>>(
  kebabActions: RowAction<T>[],
  row: T,
  testIdPrefix: string,
  getRowId: (row: T) => string | number,
): React.ReactNode {
  const copy = useDataViewsCopy();
  const items: DropdownMenuItem[] = kebabActions
    .filter((action) => action.isVisible?.(row) ?? true)
    .map((action) => ({
      id: action.id,
      label: action.rowLabel ? action.rowLabel(row) : action.label,
      color: action.color,
      onClick: () => void action.onSelect([row]),
    }));
  if (items.length === 0) return null;
  return (
    <DropdownMenu
      size="sm"
      items={items}
      trigger={
        <Button variant="text" size="sm" dataTestId={`${testIdPrefix}-actions-${getRowId(row)}`} aria-label={copy.grid.rowActions}>
          ⋮
        </Button>
      }
    />
  );
}

/** Sort options derived from the sortable columns when a page supplies none. */
export function defaultSortFields<T extends Record<string, unknown>>(
  columns: DataViewColumn<T>[],
): SortFieldDefinition[] {
  return columns
    .filter(
      (col) =>
        col.enableSort !== false &&
        col.type !== "actions" &&
        col.id !== "actions" &&
        typeof col.header === "string" &&
        col.header !== "",
    )
    .map((col) => ({
      value: col.id,
      label: col.header as string,
      orderOptions: [
        { value: "asc", label: "Crescente" },
        { value: "desc", label: "Decrescente" },
      ],
    }));
}

/** Count active filters (search + selected pills + bounded ranges) for the badge. */
export function computeActiveFilterCount<T extends Record<string, unknown>>(
  state: DataViewState,
  fields: FilterFieldConfig<T>[],
  rangeFields: RangeFieldConfig<T>[],
): number {
  const ranges = state.ranges ?? {};
  const pillCount = fields.reduce((n, field) => n + ((state.pills[field.id]?.length ?? 0) > 0 ? 1 : 0), 0);
  const rangeCount = rangeFields.reduce((n, field) => {
    const range = ranges[field.id];
    return n + (range && (range.min != null || range.max != null) ? 1 : 0);
  }, 0);
  return (state.search.trim() ? 1 : 0) + pillCount + rangeCount;
}

function bulkMenuItems<T extends Record<string, unknown>>(
  rowActions: RowAction<T>[],
  selectedRows: T[],
  clearSelection: () => void,
): DropdownMenuItem[] {
  return rowActions
    .filter((action) => action.bulk !== false)
    .map((action) => {
      // State-machine guards: the action runs only on the rows it applies to,
      // and disappears from the menu when none of the selection qualifies.
      const targets = action.isVisible ? selectedRows.filter(action.isVisible) : selectedRows;
      return { action, targets };
    })
    .filter(({ targets }) => targets.length > 0)
    .map(({ action, targets }) => ({
      id: action.id,
      label: action.label,
      color: action.color,
      onClick: () => {
        // Run the (possibly async) handler on the captured selection, then clear
        // it — but only once the work settles. On failure keep the selection so
        // the user can see which rows still need action and retry.
        const result = action.onSelect(targets);
        if (result instanceof Promise) {
          void result.then(
            () => clearSelection(),
            () => {
              /* keep the selection on failure so the user can retry */
            },
          );
        } else {
          clearSelection();
        }
      },
    }));
}

interface RenderBulkArgs<T extends Record<string, unknown>> {
  rowActions: RowAction<T>[] | undefined;
  bulkActions: ((selectedRows: T[], clearSelection: () => void) => React.ReactNode) | undefined;
  selectedRows: T[];
  clearSelection: () => void;
  testIdPrefix: string;
}

/**
 * The selection bulk control shown in the toolbar. Prefers the reusable
 * `rowActions` (an "Ações" dropdown mirroring the row kebab); falls back to the
 * low-level `bulkActions` render prop. Renders nothing with no selection.
 */
export function renderBulkActions<T extends Record<string, unknown>>({
  rowActions,
  bulkActions,
  selectedRows,
  clearSelection,
  testIdPrefix,
}: RenderBulkArgs<T>): React.ReactNode {
  const copy = useDataViewsCopy();
  if (selectedRows.length === 0) return undefined;
  if (rowActions) {
    const items = bulkMenuItems(rowActions, selectedRows, clearSelection);
    if (items.length === 0) return undefined;
    return (
      <DropdownMenu
        size="sm"
        items={items}
        trigger={
          <Button variant="outline" size="sm" dataTestId={`${testIdPrefix}-bulk-actions`}>
            {copy.grid.bulkActions(selectedRows.length)}
          </Button>
        }
      />
    );
  }
  return bulkActions ? bulkActions(selectedRows, clearSelection) : undefined;
}

/** Toggle a single value in a pill's selected-list (returns the next list). */
export function togglePillValues(current: string[] | undefined, value: string, checked: boolean): string[] {
  const list = current ?? [];
  return checked ? [...list, value] : list.filter((v) => v !== value);
}

/**
 * The card grid's `grid-template-columns`, as an sx fragment.
 *
 * One rule at every width: each card asks for `targetWidth` and `auto-fill`
 * decides how many fit. Density moves the target, so it changes the count at
 * every size — which the previous column-count cap could not do, because its
 * track floor bottomed out at a constant shared by all three densities.
 *
 * Below `sm` this is a single column, and no target changes that. That is why
 * the density control hides itself there rather than offering three settings
 * that all draw the same thing.
 */
export function cardGridTracks(targetWidth: number) {
  return {
    gridTemplateColumns: {
      xs: "1fr",
      sm: `repeat(auto-fill, minmax(${targetWidth}px, 1fr))`,
    },
  };
}
