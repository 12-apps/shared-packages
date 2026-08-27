import type { ReactNode } from 'react';

/* ── ContentToolbar (the bar shell) ──────────────────────────────────────── */

/** Props for {@link ContentToolbar} — the shared content-page toolbar. */
export interface ContentToolbarProps {
  /** The two bulk-selection buttons, spelled out where the bar has room. */
  selectAllText: string;
  clearAllText: string;
  /**
   * The select-all checkbox's accessible name. It carries no visible label of
   * its own, so this is the only thing a screen reader gets for it. REQUIRED:
   * this package ships no default copy.
   */
  selectAllLabel: string;
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
   * Controls that share the toolbar's own line, left-aligned after the
   * selection cluster — the search box and the filter controls, which belong on
   * the toolbar rather than on a row of their own. Left unset the toolbar keeps
   * its two-cluster shape.
   */
  leadingControls?: ReactNode;
  /**
   * Selection OWNS the toolbar line instead of sharing it. Nothing selected ⇒
   * no Select All at all (the row is search + filters + controls); something
   * selected ⇒ those give way entirely and only the selection cluster remains.
   *
   * Off by default: a toolbar that already shows Select All permanently keeps
   * doing so, so this cannot move a control on a consumer that did not ask.
   */
  exclusiveSelection?: boolean;
  /**
   * Selection actions slot, rendered after the count when items are selected
   * (e.g. a "Delete" / "Send email" control). Kept generic — the consumer owns
   * what the action does.
   */
  actions?: ReactNode;
  /**
   * A control rendered between the count and {@link actions}, and ONLY while
   * something is selected.
   *
   * It is a second slot rather than more room in `actions` because the two
   * answer different questions. `actions` is what HAPPENS to the selection;
   * this is what the selection IS — the "select all 143 matching" widening
   * that a paginated grid needs once its whole page is ticked. Folding a
   * widening control into the actions menu would file "change what I picked"
   * under "do this to what I picked", where an operator reasonably expects
   * every entry to write something.
   *
   * Ignored when nothing is selected: a widening has nothing to widen.
   */
  selectionExtra?: ReactNode;
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
  /** The card-size control's accessible name — it renders icons only. */
  cardSizeLabel: string;
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
  /** The menu's two section headings, and the trigger's own prefix. */
  orderHeading: string;
  sortHeading: string;
  triggerPrefix: string;
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
  /** The extra-options section heading, and the clear-selection action. */
  extraOptionsHeading: string;
  clearText: string;
  /** Label before the trigger (e.g. "Content Type"). */
  label: string;
  options: MultiSelectOption<TValue>[];
  /** Selected values. Empty or full set both display `allLabel`. */
  selected: ReadonlySet<TValue>;
  onToggle: (value: TValue, checked: boolean) => void;
  onClear: () => void;
  /** Text when nothing or everything is selected. @default "All" */
  allLabel?: string;
  /**
   * The clear affordance's accessible name. The pill's own label is already on
   * screen, so this is all a screen reader gets for the little cross.
   * REQUIRED: this package ships no default copy.
   */
  clearLabel: string;
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
  /**
   * Trigger layout. `inline` (default) renders a compact `Label:` text button for
   * a horizontal toolbar. `stacked` renders the label on its own line above a
   * full-width, outlined select-style control (a filter panel). `pill` renders a
   * rounded outlined chip (`Label ▾`, with a count when a selection is active) —
   * for a horizontal filter row.
   * @default "inline"
   */
  layout?: 'inline' | 'stacked' | 'pill';
  'data-testid'?: string;
  /**
   * Notified when the menu opens and closes.
   *
   * For a toolbar whose LAYOUT is measured: applying a filter changes this
   * control's label and therefore its width, and re-measuring mid-interaction
   * moves the row under the operator's cursor. A caller that measures uses this
   * to hold still while the menu is open.
   */
  onOpenChange?: (open: boolean) => void;
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
  /**
   * Every word this menu renders. REQUIRED since FUT-760: it used to be
   * `Partial<…>` over a pt-BR default, so a host that passed nothing shipped
   * one product's Portuguese. `PT_BR_SAVED_VIEWS_LABELS` is that exact set.
   */
  labels: SavedViewsLabels;
  testIdPrefix?: string;
}
