import type React from 'react';
import type { AutocompleteCopy } from '../../../copy';

/**
 * A suggestion's behavior on select:
 * - `search` (default) — fills the input with the suggestion's label.
 * - `link` — opens the suggestion's {@link AutocompleteOption.url} in a new tab
 *   instead of changing the input (Google-style "go to" result).
 */
export type SuggestionType = 'search' | 'link';

export interface AutocompleteOption<T = unknown> {
  id?: string;
  key?: string;
  value?: string;
  label?: string;
  name?: string;
  text?: string;
  description?: string;
  /** When `link`, selecting the suggestion opens {@link url} instead of filling the input. */
  type?: SuggestionType;
  /** Target URL for a `link` suggestion. */
  url?: string;
  data?: T;
}

export interface AutocompleteProps<T = AutocompleteOption> {
  /**
   * The two rows the dropdown shows in place of options — while an async
   * fetch is in flight, and when it came back empty. REQUIRED: this package
   * ships no default copy.
   */
  copy: AutocompleteCopy;
  /** Controlled input value */
  value: string;
  /** Input value change */
  onChange: (val: string) => void;

  /** Suggestion items (generic) */
  suggestions: T[];
  /** Unique key extractor */
  getKey?: (item: T) => string;
  /** Text label extractor */
  getLabel?: (item: T) => string;
  /** Optional description extractor (for SR and UI) */
  getDescription?: (item: T) => string | undefined;
  /** Custom row renderer */
  renderSuggestion?: (item: T, state: { active: boolean; query: string }) => React.ReactNode;
  /** Called when a suggestion is chosen */
  onSelect?: (item: T) => void;

  /**
   * Resolve a suggestion's {@link SuggestionType}. A `link` suggestion opens
   * {@link getUrl} on select (via {@link openLink}) instead of filling the input,
   * and the default renderer shows a link icon; a `search` suggestion (default)
   * shows a search icon and fills the input. Return `undefined` for untyped
   * suggestions (no icon, classic behavior).
   */
  getSuggestionType?: (item: T) => SuggestionType | undefined;
  /** Resolve the URL for a `link` suggestion. */
  getUrl?: (item: T) => string | undefined;
  /**
   * Open a `link` suggestion. Defaults to
   * `window.open(url, '_blank', 'noopener,noreferrer')`; override for a router or
   * to assert the call in tests.
   */
  openLink?: (url: string, item: T) => void;

  /** Allow values not in suggestions */
  allowFreeText?: boolean;
  /** Enable multiple selection (chips) */
  multiple?: boolean;
  /** Selected items in multiple mode */
  selectedItems?: T[];
  /** Update selected items in multiple mode */
  onSelectedItemsChange?: (items: T[]) => void;

  /** Async mode flags */
  async?: boolean;
  isLoading?: boolean;
  /** Debounce in ms for local filtering or remote fetch triggers */
  debounceMs?: number;

  /** Inline completion remainder visibility */
  showGhostText?: boolean;
  /** Optional leading adornment inside the input (e.g. a search icon). */
  startAdornment?: React.ReactNode;
  /** Case/fuzzy options (local filtering only) */
  matchMode?: 'startsWith' | 'contains' | 'fuzzy';

  /** A11y & structure */
  id?: string;
  inputAriaLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;

  /** Styling hooks */
  className?: string;
  inputClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  chipClassName?: string;

  /** Portal the popup if desired */
  portal?: boolean | { container?: HTMLElement };
  /** Max visible items before scroll */
  maxVisibleItems?: number;
}

export interface AutocompleteState {
  open: boolean;
  activeIndex: number;
  ghost: string;
  inputValue: string;
  composition: boolean;
}

export interface SuggestionItemState {
  active: boolean;
  query: string;
}
