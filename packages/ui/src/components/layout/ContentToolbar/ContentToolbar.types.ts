import type { ReactNode } from 'react';

/* ── ContentToolbar (the bar shell) ──────────────────────────────────────── */

/** Props for {@link ContentToolbar} — the shared content-page toolbar. */
export interface ContentToolbarProps {
  /** Whether the page is in selection mode (shows Clear All + count + actions). */
  hasSelection: boolean;
  /** Number of currently selected items. */
  selectedCount: number;
  /** Select every item on the page. */
  selectAll: () => void;
  /** Clear the current selection. */
  clearSelection: () => void;
  /** Page-specific right-aligned controls (ViewSelector, SortByDropdown, …). */
  rightControls: ReactNode;
  /**
   * Selection actions slot, rendered after the count when items are selected
   * (e.g. a "Delete" / "Send email" control). Kept generic — the consumer owns
   * what the action does.
   */
  actions?: ReactNode;
  /** Test id for the Select All button. */
  selectAllTestId?: string;
  /** Test id for the Clear All button. */
  clearAllTestId?: string;
  /**
   * Compensate for inner button padding so the leading "Select All" and the
   * trailing control align flush with a `px-N` parent's edges. Only enable when
   * the toolbar is the sole child of that padded wrapper.
   */
  edgeAlign?: boolean;
}

/* ── ViewSelector ────────────────────────────────────────────────────────── */

/** Grid or list layout for a content page. */
export type ViewMode = 'grid' | 'list';

/** Props for {@link ViewSelector}. */
export interface ViewSelectorProps {
  /** Current view mode. */
  viewMode: ViewMode;
  /** Called when the view mode changes. */
  onViewModeChange: (mode: ViewMode) => void;
  /** Card-size zoom for grid view (single-element `[0–100]`); grid mode only. */
  zoom: number[];
  /** Called when the zoom slider changes. */
  onZoomChange: (value: number[]) => void;
}

/* ── SortByDropdown ──────────────────────────────────────────────────────── */

/** A single order option (e.g. "Newest"/"Oldest") for a sort field. */
export interface SortOrderOption {
  value: string;
  label: string;
  /** Arrow shown in the trigger. Defaults to `down` for the first option. */
  arrowDirection?: 'up' | 'down';
}

/** Definition of one sortable field. */
export interface SortFieldDefinition<TField extends string = string> {
  value: TField;
  label: string;
  /** When present, the "Order" section renders with these options. */
  orderOptions?: SortOrderOption[];
  /** Show the active order label in the trigger text. @default true */
  showOrderInTrigger?: boolean;
  /**
   * Trigger-label style: `single` shows the selected order + a direction arrow
   * (e.g. "Name (a–z) ↓"); `range` shows both ends joined (e.g. "Size
   * (large–small)") and hides the arrow. @default 'single'
   */
  triggerLabelStyle?: 'single' | 'range';
}

/** Props for {@link SortByDropdown}. */
export interface SortByDropdownProps<TField extends string = string> {
  fields: SortFieldDefinition<TField>[];
  activeField: TField;
  activeOrder?: string;
  onFieldChange: (field: TField) => void;
  onOrderChange?: (order: string) => void;
  'data-testid'?: string;
}

/* ── MultiSelectDropdown ─────────────────────────────────────────────────── */

/** A selectable option with an optional item count. */
export interface MultiSelectOption<TValue extends string = string> {
  value: TValue;
  label: string;
  count?: number;
}

/** A toggle in the optional "Options" section below the main list. */
export interface MultiSelectExtraOption {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Props for {@link MultiSelectDropdown}. */
export interface MultiSelectDropdownProps<TValue extends string = string> {
  /** Label before the trigger (e.g. "Content Type"). */
  label: string;
  options: MultiSelectOption<TValue>[];
  /** Selected values. Empty or full set both display `allLabel`. */
  selected: ReadonlySet<TValue>;
  onToggle: (value: TValue, checked: boolean) => void;
  onClear: () => void;
  /** Text when nothing or everything is selected. @default "All" */
  allLabel?: string;
  /** Extra toggles under a labelled "Options" section. */
  extraOptions?: MultiSelectExtraOption[];
  /**
   * Show a search box that filters options by label (case-insensitive). Useful
   * for long lists (e.g. many categories). @default `options.length > 8`
   */
  searchable?: boolean;
  /** Placeholder for the search box (when `searchable`). @default "Search…" */
  searchPlaceholder?: string;
  /** Shown when the search matches no options. @default "No results" */
  noResultsLabel?: string;
  'data-testid'?: string;
}

/* ── FilterTrigger ───────────────────────────────────────────────────────── */

/** Props for {@link FilterTrigger} — the labeled "Filtros" toggle button. */
export interface FilterTriggerProps {
  /** Whether the associated filter panel is open. */
  open: boolean;
  /** Toggle the filter panel open/closed. */
  onOpenChange: (open: boolean) => void;
  /** Mark the button as "filtered" (active styling) — implied when `activeCount > 0`. */
  hasActiveFilters?: boolean;
  /** Number of active filters; renders a count badge and active styling when > 0. */
  activeCount?: number;
  /** Button label. @default "Filtros" */
  label?: string;
  'data-testid'?: string;
}

/* ── ColumnsMenu ─────────────────────────────────────────────────────────── */

/** One toggleable column in the {@link ColumnsMenu}. */
export interface ColumnVisibilityOption {
  /** Stable column id passed back to `onToggle`. */
  id: string;
  /** Human label shown beside the checkbox. */
  label: string;
  /** Whether the column is currently visible (checkbox checked). */
  visible: boolean;
  /** Disable the row (e.g. a required column that can't be hidden). */
  locked?: boolean;
}

/** Props for {@link ColumnsMenu} — the stateless column-visibility selector. */
export interface ColumnsMenuProps {
  /** The hideable columns and their current visibility. */
  columns: ColumnVisibilityOption[];
  /** Called when a column is toggled; the caller owns the state. */
  onToggle: (id: string, visible: boolean) => void;
  /** Popover header. @default "Columns" */
  title?: string;
  /** Accessible label for the icon trigger. @default "Toggle columns" */
  ariaLabel?: string;
  'data-testid'?: string;
}

/* ── SavedViewsMenu ──────────────────────────────────────────────────────── */

/** Minimal shape the {@link SavedViewsMenu} needs to render a saved view. */
export interface SavedViewLike {
  id: string;
  name: string;
  /** Pinned views surface under the "pinned" section. */
  pinned?: boolean;
  /** The user's default view (shows a tag). */
  isDefault?: boolean;
  /** Whether the signed-in user owns (and may mutate) this view. */
  isOwner?: boolean;
  /** Whether the view is shared with the team. */
  shared?: boolean;
}

/** All user-facing strings in {@link SavedViewsMenu}; every field is optional. */
export interface SavedViewsLabels {
  trigger: string;
  /** The built-in no-filter default view (shown at the top + as the trigger label). */
  mainView: string;
  pinned: string;
  recent: string;
  empty: string;
  saveCurrent: string;
  manageAll: string;
  apply: string;
  setDefault: string;
  pin: string;
  unpin: string;
  share: string;
  unshare: string;
  edit: string;
  remove: string;
  defaultTag: string;
}

/** Props for {@link SavedViewsMenu} — the stateless saved-views dropdown. */
export interface SavedViewsMenuProps<V extends SavedViewLike = SavedViewLike> {
  views: V[];
  /** When set, the trigger + active row reflect this saved view; else "Main vision" is active. */
  activeViewName?: string;
  onApply: (view: V) => void;
  /** Switch to the built-in no-filter "Main vision" default. */
  onSelectMain: () => void;
  onSaveCurrent: () => void;
  onEdit: (view: V) => void;
  onDelete: (view: V) => void;
  onSetDefault: (view: V) => void;
  onTogglePin: (view: V) => void;
  onToggleShare: (view: V) => void;
  onManageAll: () => void;
  /** Override any of the default (pt-BR) strings. */
  labels?: Partial<SavedViewsLabels>;
  testIdPrefix?: string;
}
