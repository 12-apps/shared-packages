import type React from 'react';

/**
 * A single toggleable filter chip in the palette's filter row (e.g. "Last 7
 * days", "From me"). App-agnostic: the host owns the ids and what they mean.
 */
export interface SearchFilterChip {
  /** Stable id toggled in {@link SearchPaletteProps.activeFilterIds}. */
  id: string;
  /** Chip text. */
  label: string;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
}

/**
 * The leading visual of a result row — a product image, a contact avatar, or a
 * type icon. Mirrors the Gmail-style result list where each row has one lead.
 */
export type SearchResultLead =
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'avatar'; src?: string; alt?: string; fallback?: string }
  | { kind: 'icon'; node: React.ReactNode };

export interface SearchPaletteProps<T> {
  /** Controlled query string. */
  value: string;
  /** Query change (typing). */
  onChange: (value: string) => void;

  /** Result items to render (already filtered/ranked by the host). */
  items: T[];
  /** Stable key extractor. */
  getKey: (item: T) => string;
  /** Primary line (the match is bold-highlighted against the query). */
  getPrimary: (item: T) => string;
  /** Optional secondary line (e.g. email, SKU, category). */
  getSecondary?: (item: T) => string | undefined;
  /** Optional leading visual (image / avatar / icon). */
  getLead?: (item: T) => SearchResultLead | undefined;
  /** Optional trailing node (e.g. a date). */
  getTrailing?: (item: T) => React.ReactNode | undefined;
  /** Selection handler for a result row. */
  onSelect: (item: T) => void;
  /** Max rows shown before the list scrolls / truncates (default 5). */
  maxItems?: number;

  /** Filter chips row. Omit for no chips. */
  filters?: SearchFilterChip[];
  /** Ids of the currently-active chips. */
  activeFilterIds?: string[];
  /** Toggle handler for a chip id. */
  onToggleFilter?: (id: string) => void;

  /** Footer "see all results" action; hidden when omitted. */
  onSubmitAll?: (query: string) => void;
  /** Footer label builder; defaults to `Todos os resultados para "{q}"`. */
  submitAllLabel: (query: string) => string;

  /**
   * Content shown when the query is empty (e.g. a "Populares" block). Keeps the
   * component app-agnostic — the host supplies whatever pre-typing UI it wants.
   */
  emptyQueryContent?: React.ReactNode;
  /** Message when a non-empty query yields no items. */
  noResultsLabel: string;

  /** Loading spinner in the input while results resolve. */
  isLoading?: boolean;
  /** Inline ghost-text completion of the top result (Tab/→ accepts). */
  showGhostText?: boolean;
  /** Autofocus the input on mount. */
  autoFocus?: boolean;
  placeholder: string;
  inputAriaLabel?: string;
  /** Esc handler (host closes the overlay). */
  onClose?: () => void;

  className?: string;
  /** Test id for the outer card (default `search-palette`). */
  dataTestId?: string;
}
