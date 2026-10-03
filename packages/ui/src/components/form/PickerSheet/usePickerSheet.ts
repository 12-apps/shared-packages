'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { pickerSheetView, stepActiveIndex, type PickerSheetView } from './picker-sheet-model';
import type { PickerSheetProps } from './PickerSheet.types';

/** Everything the sheet's parts read: the query, the derived list, the cursor and the handlers. */
interface PickerSheetState {
  query: string;
  view: PickerSheetView;
  /** The keyboard cursor, an index into `view` (items, then the create row); -1 for none. Always a row that exists. */
  activeIndex: number;
  /** Draw the cursor: only once an arrow key has moved it, never from typing alone. */
  cursorShown: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLUListElement | null>;
  setQuery: (next: string) => void;
  /** Pick the row at `index` — an item, or the create row when it is the last one. */
  choose: (index: number) => void;
  onSearchKeyDown: (event: React.KeyboardEvent) => void;
}

type HookProps = Pick<PickerSheetProps, 'open' | 'items' | 'onPick' | 'onCreate' | 'createLabel'>;

/**
 * Keep the keyboard cursor in view.
 *
 * Nothing inside is focused on open — the modal focuses its own paper. Focusing
 * the search box raised a phone's keyboard over the list it was opened to show.
 * The list opens at its top, the selected row wherever it falls (the design's
 * picker does not jump to it).
 */
function useCursorScroll(activeIndex: number, listRef: React.RefObject<HTMLUListElement | null>): void {
  useEffect(() => {
    if (activeIndex < 0) return;
    const rows = listRef.current?.querySelectorAll('[role="option"]');
    rows?.[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listRef]);
}

/**
 * The sheet's state. The query resets every time the sheet opens; typing puts
 * the cursor on the first match, so "type, then Enter" picks it (or creates,
 * when the create row is all there is).
 */
export function usePickerSheet({ open, items, onPick, onCreate, createLabel }: HookProps): PickerSheetState {
  const [query, setRawQuery] = useState('');
  const [rawActiveIndex, setActiveIndex] = useState(-1);
  const [cursorShown, setCursorShown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Reset while rendering the frame that opens the sheet, not in an effect
  // after it — an effect would paint the last session's query for one frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRawQuery('');
      setActiveIndex(-1);
      setCursorShown(false);
    }
  }

  const creatable = Boolean(onCreate && createLabel);
  const view = useMemo(() => pickerSheetView(items, query, creatable), [items, query, creatable]);
  // Clamped on read: the rows can shrink under the cursor (a query, new items),
  // and `aria-activedescendant` must never name a row that is not there.
  const activeIndex = rawActiveIndex < view.rowCount ? rawActiveIndex : -1;

  useCursorScroll(activeIndex, listRef);

  const setQuery = useCallback((next: string) => {
    setRawQuery(next);
    setActiveIndex(next.trim() ? 0 : -1);
  }, []);

  const choose = useCallback(
    (index: number) => {
      const item = view.items[index];
      if (item) {
        onPick(item.id);
        return;
      }
      if (view.canCreate && index === view.items.length) onCreate?.(view.query);
    },
    [view, onPick, onCreate],
  );

  const onSearchKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex(stepActiveIndex(activeIndex, delta, view.rowCount));
        setCursorShown(true);
        return;
      }
      if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        choose(activeIndex);
      }
      // Escape is the modal's: it closes through `onClose`, once.
    },
    [view.rowCount, activeIndex, choose],
  );

  return { query, view, activeIndex, cursorShown, searchInputRef, listRef, setQuery, choose, onSearchKeyDown };
}
