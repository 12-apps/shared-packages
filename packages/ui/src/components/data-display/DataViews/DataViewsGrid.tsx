"use client";

import { useEffect, useRef } from "react";

import { type SortFieldDefinition } from "../../layout/ContentToolbar";

import { GridShell } from "./data-views-grid-parts";
import type { BoardConfig } from "./DataViewsBoard";
import type { DataViewExport } from "./data-views-export";
import type { ScopeConfig } from "./data-views-scopes";
import type { DataViewCardSelection } from "./data-views-types";
import {
  type DataViewColumn,
  type DataViewsLayout,
  type DataViewServer,
  type DataViewState,
  type DataViewSyncState,
  type FilterFieldConfig,
  type RangeFieldConfig,
  type RowAction,
} from "./data-views-types";
import { useDataViewsState } from "./use-data-views-state";

interface DataViewsGridProps<T extends Record<string, unknown>> {
  rows: T[];
  columns: DataViewColumn<T>[];
  fields: FilterFieldConfig<T>[];
  /** Optional numeric min/max range filters (advanced "filter by amount"). */
  rangeFields?: RangeFieldConfig<T>[];
  getRowId: (row: T) => string | number;
  /** Row click opens the row; clicks in the actions column are ignored. */
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  dataTestId?: string;
  testIdPrefix?: string;
  /** Seed/replace the view state. A NEW reference re-applies (used to apply a saved view). */
  appliedState?: DataViewState;
  /**
   * URL-driven controls (search/pills/ranges/sort) that RE-APPLY on reference
   * change while preserving column visibility — for server-mode lists that keep
   * their filter/sort/page in the address bar (see {@link DataViewSyncState}).
   */
  syncState?: DataViewSyncState;
  /** Notified on every view-state change (so a save-view modal can read it). */
  onStateChange?: (state: DataViewState) => void;
  /**
   * Notified with the currently-visible (search + filter matched) rows whenever
   * they change — so a page-level Export exports what the user sees, not the
   * full dataset.
   */
  onVisibleRowsChange?: (rows: T[]) => void;
  /** Saved-views UI injected into the toolbar (FUT-89). */
  toolbarRightSlot?: React.ReactNode;
  /** Big page title in the header row (next to the funnel + gear). */
  title?: string;
  /** Primary page actions rendered at the header's right. */
  headerActions?: React.ReactNode;
  /**
   * Sort options for the toolbar's "Sort By" dropdown. Defaults to the sortable
   * columns (asc/desc each) when omitted.
   */
  sortFields?: SortFieldDefinition[];
  /**
   * Per-sort-field VALUE KIND (`"currency" | "number" | "date" | "text"`), so the
   * Exibir panel phrases the direction in that column's own terms. "Crescente"
   * on a currency column is a puzzle; "Menor → maior" is not. Defaults to text.
   */
  sortKinds?: Record<string, string>;
  /**
   * Opt-in "Exportar" control. The grid hands the host the current query,
   * UNPAGINATED, and the host re-queries — the grid never fetches, and an
   * export therefore follows the filters rather than the loaded page.
   */
  exportConfig?: DataViewExport;
  /**
   * A single, reusable list of row actions that drives BOTH the per-row "⋮"
   * kebab AND the bulk-actions menu (tabwoah model). When provided, the grid
   * appends a kebab actions column automatically (unless the page already
   * defines one) and shows an "Ações" bulk menu when rows are selected.
   */
  rowActions?: RowAction<T>[];
  /**
   * Extra leading control rendered in the auto kebab column, before the "⋮"
   * (e.g. a favourite star). Only used when `rowActions` is set.
   */
  rowActionsLeading?: (row: T) => React.ReactNode;
  /**
   * Low-level override for the selection bulk control. Prefer `rowActions`.
   * Receives the selected rows + a `clearSelection` callback.
   */
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  /**
   * Render a bespoke per-row menu in the actions column instead of the auto
   * kebab — typically an entity's self-contained 3-dots menu that owns its own
   * popups, so the SAME menu component drives both the table row and the card.
   * `rowActions`/`bulkActions` still drive the multi-row bulk menu.
   */
  renderRowMenu?: (row: T) => React.ReactNode;
  /**
   * Opt-in "Grade" (cards) layout. When provided, a Grade/Tabela toggle appears in
   * the toolbar and the cards body renders each visible row via this function
   * (reusing the same search/filter/sort). Omit ⇒ table only (unchanged).
   */
  renderCard?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /**
   * Opt-in "Quadro" (board) layout: the loaded page laid out as columns of one
   * grouping field. Reuses `renderCard`, so supplying a board WITHOUT one simply
   * offers no board. Best when the groups are states in a state machine — derive
   * these groups and `scopes` from ONE definition so the two cannot drift.
   */
  board?: BoardConfig<T>;
  /**
   * Opt-in "Lista" layout (FUT-733): one FULL-WIDTH row per record, rendered by
   * the entity — a marker, a title, a subtitle and a value on the right. Sits
   * between the table (compare columns) and the cards (browse); omit ⇒ not
   * offered, exactly as `renderCard` gates the cards.
   */
  renderListRow?: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  /**
   * The page-level partition rendered as an exclusive tab strip above the
   * toolbar, with server-supplied counts. Requires `server`: a scope is applied
   * at the backend, never in the browser.
   */
  scopes?: ScopeConfig[];
  /** The row field the scopes partition by — used only to reject a pill over the same field. */
  scopeFieldId?: string;
  /** Which layout to show first when the user has expressed no preference (default "table"). */
  defaultLayout?: DataViewsLayout;
  /**
   * Opt into the responsive inline filter UX (collapsible filter row on wide
   * screens, modal on narrow). Default `false` keeps the classic slide-in panel.
   */
  inlineFilters?: boolean;
  /** Keep the inline search visible with no filter fields and no active search. */
  alwaysShowSearch?: boolean;
  /** Server-mode wiring; when set the grid is backend-driven (no client filter/sort/paginate). */
  server?: DataViewServer;
}

/**
 * Surface the visible (filtered) rows so a page-level Export matches the view.
 *
 * Pages pass inline column/field arrays, so `matched` is a fresh reference on
 * every render even when its contents are unchanged. The guard is a signature
 * over the rows' *contents* (not just their ids), so the callback — and the
 * parent `useState` it usually drives — fires only when the visible data
 * actually changes. Ids alone are not enough: a server refresh can change a
 * visible row's values while keeping its id, and the export must reflect them.
 * Content-equal renders keep the same signature, so this never loops.
 */
function useVisibleRowsNotifier<T>(matched: T[], onVisibleRowsChange?: (rows: T[]) => void): void {
  const visibleSignature = JSON.stringify(matched);
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (lastSignature.current === visibleSignature) return;
    lastSignature.current = visibleSignature;
    onVisibleRowsChange?.(matched);
  }, [visibleSignature, matched, onVisibleRowsChange]);
}

/**
 * The reusable admin DataViews table (FUT-88): the shared ContentToolbar +
 * TableFilter panel over `@12-apps/ui` DataGrid. State + derived data live in
 * {@link useDataViewsState}; the render lives in `GridShell`. This component just
 * connects the two. Reused across every admin list page.
 */
export function DataViewsGrid<T extends Record<string, unknown>>(
  props: DataViewsGridProps<T>,
): React.JSX.Element {
  // Forwarded as a whole rather than restated name-by-name twice: this component
  // only ADDS the controller, and a 25-name destructure repeated in the JSX is
  // where a newly added prop silently stops being passed on.
  const { rangeFields = [], testIdPrefix = "table" } = props;
  const controller = useDataViewsState({ ...props, rangeFields, testIdPrefix });
  useVisibleRowsNotifier(controller.matched, props.onVisibleRowsChange);
  return <GridShell {...props} c={controller} rangeFields={rangeFields} testIdPrefix={testIdPrefix} />;
}
