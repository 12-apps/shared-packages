import type { SuggestionType } from './Autocomplete.types';

/** Local filtering strategy. */
export type MatchMode = 'startsWith' | 'contains' | 'fuzzy';

/** Default key extractor: id/key/value/label, else the item itself stringified. */
export const defaultGetKey = <T,>(item: T): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    return String(obj.id ?? obj.key ?? obj.value ?? obj.label ?? obj);
  }
  return String(item);
};

/** Default label extractor: label/name/text, else the item itself stringified. */
export const defaultGetLabel = <T,>(item: T): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    return String(obj.label ?? obj.name ?? obj.text ?? obj);
  }
  return String(item);
};

/** Default suggestion-type extractor: reads a `type: 'search' | 'link'` field. */
export const defaultGetSuggestionType = <T,>(item: T): SuggestionType | undefined => {
  if (typeof item === 'object' && item !== null) {
    const { type } = item as { type?: unknown };
    if (type === 'search' || type === 'link') return type;
  }
  return undefined;
};

/** Default URL extractor for `link` suggestions: reads a `url: string` field. */
export const defaultGetUrl = <T,>(item: T): string | undefined => {
  if (typeof item === 'object' && item !== null) {
    const { url } = item as { url?: unknown };
    if (typeof url === 'string') return url;
  }
  return undefined;
};

/** Default link opener: a new tab with `noopener,noreferrer`. SSR-guarded. */
export const defaultOpenLink = (url: string): void => {
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

/** Fuzzy match: every char of `query` appears in `label`, in order. */
function fuzzyMatch(label: string, query: string): boolean {
  let labelIndex = 0;
  for (let queryIndex = 0; queryIndex < query.length; queryIndex++) {
    const char = query[queryIndex];
    if (!char) continue;
    labelIndex = label.indexOf(char, labelIndex);
    if (labelIndex === -1) return false;
    labelIndex++;
  }
  return true;
}

/** True when `label` matches `query` under the given {@link MatchMode} (case-insensitive). */
function matchesQuery(label: string, query: string, matchMode: MatchMode): boolean {
  const haystack = label.toLowerCase();
  const needle = query.toLowerCase();
  if (matchMode === 'startsWith') return haystack.startsWith(needle);
  if (matchMode === 'fuzzy') return fuzzyMatch(haystack, needle);
  return haystack.includes(needle);
}

/** Filter `suggestions` by `query` under `matchMode`; an empty query returns all. */
export function filterSuggestions<T>(
  suggestions: T[],
  query: string,
  matchMode: MatchMode,
  getLabel: (item: T) => string,
): T[] {
  if (!query) return suggestions;
  return suggestions.filter((item) => matchesQuery(getLabel(item), query, matchMode));
}

/**
 * The first suggestion eligible for inline ghost completion: a non-`link` item
 * whose label starts with `inputValue` (case-insensitive) but isn't equal to it.
 * Shared by the ghost-text effect and ArrowRight completion.
 */
export function firstGhostSuggestion<T>(
  list: T[],
  inputValue: string,
  getLabel: (item: T) => string,
  getSuggestionType: (item: T) => SuggestionType | undefined,
): T | undefined {
  const needle = inputValue.toLowerCase();
  return list.find((item) => {
    const label = getLabel(item).toLowerCase();
    return getSuggestionType(item) !== 'link' && label.startsWith(needle) && label !== needle;
  });
}

/** Escape a user query for safe use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One run of a highlighted label: plain text, or text the query matched. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `label` into the runs the query matches and the runs between them, in
 * order, for the default suggestion renderer to wrap the matches in `<mark>`.
 * Every occurrence of the query matches, case-insensitively and literally (regex
 * metacharacters are escaped). Fuzzy mode (non-contiguous matches) and an empty
 * query yield the whole label as one unmatched run.
 *
 * Returns TEXT, never markup: a label is caller data (in a consumer, a user's
 * own display name), so the renderer must hand each run to React as a text
 * child, which escapes it. Building an HTML string here and injecting it is how
 * a label of `<img onerror=…>` once ran script in the host page.
 */
export function highlightLabel(label: string, query: string, matchMode: MatchMode): HighlightSegment[] {
  if (!query || matchMode === 'fuzzy') return [{ text: label, match: false }];
  // The capturing group makes `split` keep each match, at the odd indices.
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return label
    .split(regex)
    .map((text, index) => ({ text, match: index % 2 === 1 }))
    .filter((segment) => segment.text !== '');
}
