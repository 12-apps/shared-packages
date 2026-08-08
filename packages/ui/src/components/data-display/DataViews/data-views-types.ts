import type { GridColumn, GridSort } from "../DataGrid";
import type { DropdownMenuItem } from "../../navigation/DropdownMenu";
// A re-export does not bring the name into local scope, and the state/query
// types below are written in terms of it.
import type { RangeValue } from "./data-views-range-types";

/**
 * Shared types for the reusable admin "DataViews" table (FUT-88): a filter bar
 * (search-across-all + typed multi-select pills + column visibility) whose full
 * state — filters + sort + visible columns — a saved view (FUT-89) can capture
 * and restore. Each table declares its own columns + filter fields.
 */

/**
 * A single, reusable row action. ONE definition drives BOTH the per-row "⋮"
 * kebab menu and the bulk-actions menu (tabwoah model): `onSelect` receives the
 * affected rows — `[row]` from a kebab, the whole selection from the bulk menu.
 * Single-item-only actions (e.g. "Editar") set `bulk: false` so they never
 * appear in the bulk menu.
 */
export interface RowAction<T extends Record<string, unknown>> {
  /** Stable id (also the `data-testid` suffix). */
  id: string;
  /** Menu label. In the kebab, `rowLabel` overrides it per row when provided. */
  label: string;
  /** Menu-item colour (e.g. `"error"` for destructive). */
  color?: DropdownMenuItem["color"];
  /**
   * Runs on the affected rows: `[row]` from the kebab, all selected from bulk.
   * May be async — the bulk menu awaits it and only clears the selection once it
   * settles (keeping the selection on failure so the user can retry).
   */
  onSelect: (rows: T[]) => void | Promise<void>;
  /** Include in the bulk menu (2+ selected). Defaults to `true`. */
  bulk?: boolean;
  /** Include in the per-row kebab. Defaults to `true`. */
  row?: boolean;
  /** Per-row kebab label (e.g. `row.active ? "Inativar" : "Ativar"`). */
  rowLabel?: (row: T) => string;
  /**
   * Per-row applicability (e.g. state-machine guards). `false` hides the
   * kebab item for that row; in bulk the action runs only on the passing
   * rows and is dropped when none pass. Defaults to applicable.
   */
  isVisible?: (row: T) => boolean;
}

/** Selection state handed to a card renderer so it can drive its own checkbox. */
export interface DataViewCardSelection {
  selected: boolean;
  onToggleSelect: () => void;
  /**
   * Card SIZE multiplier from the toolbar zoom slider. The grid sizes the card's
   * width to `base × scale`; a card passes this to {@link BaseCard} `scale` so its
   * padding + typography grow by the same factor — the whole card scales together
   * (scale 2 → ~2× size). The proportion (aspect ratio) stays constant.
   */
  scale: number;
}

/**
 * The fixed proportions a {@link BaseCard} tile can take. The tile keeps this
 * ratio and grows in BOTH width and height as the zoom slider widens its grid
 * track, so a grid of cards stays visually uniform.
 */
export type CardAspectRatio = "1:1" | "4:3" | "16:9" | "9:16" | "3:4" | "3:1";

/** Numeric width/height factor for each {@link CardAspectRatio} (CSS `aspect-ratio`). */
export const CARD_ASPECT_RATIOS: Record<CardAspectRatio, number> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "3:4": 3 / 4,
  /**
   * The BANNER tile: too short for media, sized for two lines of text.
   *
   * Every other ratio here is picture-shaped, because they were added for cards
   * built around a thumbnail. A card whose subject is a NAME and a NUMBER — a
   * cart, an order, anything triaged rather than browsed — spends most of a 4:3
   * tile on an icon that repeats down the whole grid and says nothing.
   */
  "3:1": 3,
};

/** One selectable value inside a filter pill. */
export interface FilterOption {
  value: string;
  label: string;
}

/** A typed, multi-select filter pill's configuration for a table. */
export interface FilterFieldConfig<T extends Record<string, unknown>> {
  /** Stable id; also the default row key when no `accessor` is given. */
  id: string;
  label: string;
  options: FilterOption[];
  /**
   * How the field renders in the filter panel. `checkboxes` (default) is best for
   * a few fixed options; `multiselect` is a compact dropdown for long option
   * lists (e.g. many categories).
   */
  control?: "checkboxes" | "multiselect";
  /**
   * Forces this filter to render as a searchable multi-select dropdown with the
   * search box always shown, regardless of how many options are currently
   * loaded. Use it when the option set can grow unbounded (e.g. a filter backed
   * by a relation such as Roles or Categories). Omit it for a closed value set
   * (an enum), which keeps the plain checkbox / "search only when long"
   * behavior.
   */
  searchEnabled?: boolean;
  /**
   * Reads the row's value(s) for this field. A row matches the pill when any of
   * its values is selected. Defaults to `String(row[id])`.
   */
  accessor?: (row: T) => string | string[];
}

/**
 * The range types live in `data-views-range-types` (this file outgrew the
 * size gate); they are re-exported here so `data-views-types` stays the one
 * name every consumer imports the model from.
 */
export type {
  DayRangeFieldConfig,
  NumberRangeFieldConfig,
  RangeFieldConfig,
  RangeFieldKind,
  RangePreset,
  RangeValue,
} from "./data-views-range-types";

/** A grid column that can join the search scan and the column-visibility menu. */
export interface DataViewColumn<T extends Record<string, unknown>> extends GridColumn<T> {
  /** Included in "search across all columns" (needs a resolvable value). */
  searchable?: boolean;
  /** Toggleable in the column-visibility menu. Defaults to true; set false for
   *  structural columns (image thumbnail, actions kebab) that must always show. */
  hideable?: boolean;
}

/**
 * The DataViews layout (view type): the dense "Tabela" grid, the "Grade" of
 * cards, the "Lista" of full-width rows, or the "Quadro" board of state columns.
 * Lives with the state types rather than with the toggle because a saved view
 * CAPTURES it — see {@link DataViewState.layout}.
 */
export type DataViewsLayout = "cards" | "list" | "board" | "table";

/** The full, serializable state a view captures. */
export interface DataViewState {
  /** Free text matched across every `searchable` column. */
  search: string;
  /** fieldId → selected option values (empty/absent = no constraint). */
  pills: Record<string, string[]>;
  /** fieldId → selected numeric range (min/max). Absent/empty = no constraint. */
  ranges?: Record<string, RangeValue>;
  sortBy: GridSort[];
  /** Column ids kept visible; a hideable column not listed here is hidden. */
  visibleColumns: string[];
  /**
   * Column ids in READING ORDER. Absent ⇒ the order the table declared them in.
   *
   * Order is view state for the same reason visibility is: reordering columns is
   * an operator deciding what to read FIRST, and a saved view that restored the
   * columns but not their order would restore half a decision. Ids the table no
   * longer declares are ignored at render, and ids missing from a stale list
   * fall in after it — so a column added since the view was saved appears rather
   * than disappearing.
   */
  order?: string[];
  /**
   * The active SCOPE id — the page-level partition the scope tabs select (see
   * `ScopeConfig`). Optional, so a table that declares no scopes is untouched
   * and no view persisted before scopes existed breaks.
   *
   * Stored raw and RESOLVED at read time: the declared scopes change underneath
   * a saved view, and a view naming a scope that has since been removed must
   * fall back at render rather than break.
   */
  scope?: string;
  /**
   * The layout the view was saved in. Optional — absent means "whatever the user
   * is currently using", which is the pre-existing behaviour.
   *
   * A LAYOUT FALLBACK IS NOT A LAYOUT CHANGE: a table rendered as stacked rows
   * on a phone still has `"table"` stored here, so the view round-trips the
   * stored layout regardless of the device that opened it.
   */
  layout?: DataViewsLayout;
}

/** A pristine view state showing every given column and no filters/sort. */
export function emptyViewState(visibleColumns: string[]): DataViewState {
  return { search: "", pills: {}, ranges: {}, sortBy: [], visibleColumns };
}

/**
 * The URL-driven slice of {@link DataViewState} — the controls a server-mode host
 * mirrors from the address bar (search / pills / ranges / sort), WITHOUT
 * `visibleColumns`. Supplying it re-applies those controls when its reference
 * changes (e.g. browser back/forward or a deep-link on the same route), merging
 * over the current state so a user's show/hide column choices are preserved —
 * unlike `appliedState`, which fully replaces the state to apply a saved view.
 */
export type DataViewSyncState = Pick<
  DataViewState,
  "search" | "pills" | "ranges" | "sortBy" | "scope"
>;

/**
 * The query a SERVER-mode table emits whenever its filter/sort/page changes
 * (FUT-180). The host translates this into a backend request (see
 * `@12-apps/shared-helpers/search`) — in server mode the grid never filters,
 * sorts, or paginates in the browser; it renders exactly the page the server
 * returned. `page` is 1-based to match the backend contract.
 */
export interface DataViewQuery {
  search: string;
  pills: Record<string, string[]>;
  ranges: Record<string, RangeValue>;
  sortBy: GridSort[];
  /**
   * The RESOLVED active scope (see `resolveScope`), when the table declares
   * scopes. The KEY IS ABSENT for a table that declares none — not present-and-
   * undefined — so a host that never opted in sees a byte-identical query.
   *
   * It carries the resolved id, never the stored one: a deep link or a saved
   * view naming a scope the table no longer declares must not put that id on the
   * wire, where the backend would reject it and replace the page with an error.
   */
  scope?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-mode wiring for a DataViews table. Its PRESENCE flips the table from
 * in-browser filtering/sorting/pagination to backend-driven: the rows handed in
 * are already the current page, `totalCount` is the unpaginated total, and
 * `onQueryChange` fires (search debounced by the host) whenever the user changes
 * a filter, the sort, or the page. This is the ONLY way an admin list should run
 * (see the app-side `DataViewsTable` wrapper, which requires it).
 */
export interface DataViewServer {
  /** Total matched rows across all pages (drives the counter + page count). */
  totalCount: number;
  /** Current 1-based page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Fired when the effective query changes; the host re-fetches the page. */
  onQueryChange: (query: DataViewQuery) => void;
  /**
   * Per-scope totals for the scope tabs: `scopeId → count`. THE ONLY PIECE OF
   * THIS CONTRACT THAT CANNOT BE DONE CLIENT-SIDE — a count computed from the
   * loaded page is wrong the moment there is a second page, which is the
   * concrete bug scopes exist to fix.
   *
   * Compute it over search + pills + ranges while IGNORING the active scope.
   * Computed WITH the scope applied, every inactive tab reads zero, which is
   * worse than no counts at all.
   *
   * Omit it and the tabs render with no numbers. Nothing is ever invented from
   * the loaded rows to fill the gap.
   */
  scopeCounts?: Record<string, number>;
}

/**
 * Coerce an opaque persisted state (a saved view's JSON) into a valid
 * DataViewState, filling any missing part with a sane default. Guards against
 * legacy/older shapes so applying a saved view never renders an empty grid.
 */
export function coerceViewState(raw: unknown, allColumnIds: string[]): DataViewState {
  const value = (raw ?? {}) as Partial<DataViewState>;
  return {
    search: typeof value.search === "string" ? value.search : "",
    pills: asRecord<string[]>(value.pills),
    ranges: asRecord<RangeValue>(value.ranges),
    sortBy: Array.isArray(value.sortBy) ? value.sortBy : [],
    visibleColumns: Array.isArray(value.visibleColumns) ? value.visibleColumns : allColumnIds,
    order: Array.isArray(value.order) ? value.order : undefined,
    // Carried through UNVALIDATED against the declared scopes on purpose: a view
    // written before scopes existed has none (⇒ undefined ⇒ the first declared
    // scope at render), and one naming a since-removed scope keeps its stored id
    // here and falls back at READ time. Resolving here would rewrite the view.
    scope: typeof value.scope === "string" ? value.scope : undefined,
    layout: isLayout(value.layout) ? value.layout : undefined,
  };
}

/** Every layout this build knows how to render — the guard's single source. */
export const DATA_VIEWS_LAYOUTS: readonly DataViewsLayout[] = ["cards", "list", "board", "table"];

/** Is this a layout this build knows how to render? Guards persisted JSON. */
function isLayout(value: unknown): value is DataViewsLayout {
  return DATA_VIEWS_LAYOUTS.includes(value as DataViewsLayout);
}

/** A persisted map, or an empty one — persisted JSON can hold anything. */
function asRecord<V>(value: unknown): Record<string, V> {
  return value !== null && typeof value === "object" ? (value as Record<string, V>) : {};
}

/** A saved view as consumed by the DataViews UI (FUT-89), with ownership flag. */
export interface SavedViewSummary {
  id: string;
  name: string;
  description: string | null;
  state: DataViewState;
  shared: boolean;
  pinned: boolean;
  isDefault: boolean;
  /** True when the current user owns the view (may edit/delete/pin/share it). */
  isOwner: boolean;
}

/** A saved-view repository record (opaque `state`), as returned to server pages. */
interface SavedViewRecordLike {
  id: string;
  name: string;
  description: string | null;
  state: unknown;
  shared: boolean;
  pinned: boolean;
  isDefault: boolean;
  isOwner: boolean;
}

/** Map a repository record to the client summary (opaque state → DataViewState). */
export function toSavedViewSummary(record: SavedViewRecordLike): SavedViewSummary {
  return { ...record, state: (record.state ?? {}) as DataViewState };
}

/**
 * Dependency-injection contracts for the framework-agnostic DataViewsTableBase:
 * the host app supplies saved-view persistence + router side-effects so the ui
 * component imports neither a backend (server actions) nor a framework router.
 */

/** A saved view's editable fields, as the host persists them. */
export interface DataViewSaveInput {
  name: string;
  description: string;
  state: DataViewState;
  shared: boolean;
  pinned: boolean;
  isDefault: boolean;
}

/** Result of a persistence call — mirrors the app's `Result` without importing it. */
export type DataViewMutationResult = { ok: true } | { ok: false; error: string };

/** Injected saved-view persistence (create/update/delete), wired by the host. */
export interface DataViewPersistence {
  create: (input: DataViewSaveInput) => Promise<DataViewMutationResult>;
  update: (id: string, input: DataViewSaveInput) => Promise<DataViewMutationResult>;
  remove: (id: string) => Promise<DataViewMutationResult>;
}

/** Injected router side-effects: sync the `?view=` param and re-fetch on change. */
export interface DataViewRouter {
  syncViewParam: (viewId: string | null) => void;
  refresh: () => void;
}
