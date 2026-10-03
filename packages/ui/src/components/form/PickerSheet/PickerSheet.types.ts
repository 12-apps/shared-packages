/** One row of a {@link PickerSheetProps} list. */
export interface PickerSheetItem {
  /** Stable identity; what `onPick` receives. */
  id: string;
  /** The row's first line. */
  label: string;
  /** Second line, muted — a category's path, a price, a unit. */
  meta?: string;
  /**
   * Tree depth, 0..n, drawn as left padding steps. Applies only while the query
   * is empty: a search flattens the tree, and `meta` carries the path instead.
   */
  indent?: number;
  /** The current value: a tinted row with a check mark at the right. */
  selected?: boolean;
  /** What the query matches against. Defaults to `${label} ${meta ?? ''}`. */
  searchText?: string;
}

/**
 * A searchable pick-or-create sheet. Every word it shows comes from the caller —
 * the component ships no copy of its own.
 */
export interface PickerSheetProps {
  open: boolean;
  /** Esc, a tap outside and the close button. Picking does NOT call it; the caller closes. */
  onClose: () => void;
  /** Small muted line above the title. */
  kicker?: string;
  /** The dialog's name (`aria-labelledby`). */
  title: string;
  searchPlaceholder: string;
  /** The search input's accessible name. */
  searchLabel: string;
  /** The close button's accessible name. */
  closeLabel: string;
  items: PickerSheetItem[];
  /** Called with the picked item's id, and nothing else happens. */
  onPick: (id: string) => void;
  /**
   * The create row's text. The row is offered last when the trimmed query
   * matches no item LABEL exactly (case-insensitive), and only when `onCreate`
   * is given too.
   */
  createLabel?: (query: string) => string;
  /** Called with the trimmed query when the create row is chosen. */
  onCreate?: (query: string) => void;
  /** Shown instead of the list when nothing matches and there is no create row. */
  emptyText?: (query: string) => string;
  /** The note under the list. */
  foot?: string;
  /**
   * Base test id (default `picker-sheet`). Sub-elements get `${id}-search`,
   * `${id}-item-${item.id}`, `${id}-create`, `${id}-close`.
   */
  dataTestId?: string;
}
