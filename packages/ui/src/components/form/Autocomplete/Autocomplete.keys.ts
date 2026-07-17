import type React from 'react';

import { firstGhostSuggestion } from './Autocomplete.helpers';
import type { SuggestionType } from './Autocomplete.types';

/**
 * Everything a key handler needs. Kept as a flat context object so each handler
 * stays a small pure function and the component's `onKeyDown` is a thin dispatch.
 */
export interface KeyContext<T> {
  open: boolean;
  activeIndex: number;
  filteredSuggestions: T[];
  maxVisibleItems: number;
  allowFreeText: boolean;
  inputValue: string;
  ghost: string;
  isInputFocused: boolean;
  multiple: boolean;
  selectedItems: T[];
  getLabel: (item: T) => string;
  getSuggestionType: (item: T) => SuggestionType | undefined;
  setOpen: (open: boolean) => void;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setUserClosedDropdown: (closed: boolean) => void;
  setInputValue: (value: string) => void;
  setGhost: (ghost: string) => void;
  setJustCompletedGhost: (done: boolean) => void;
  debouncedOnChange: (value: string) => void;
  selectItem: (item: T) => void;
  onSelectedItemsChange?: (items: T[]) => void;
}

type KeyHandler<T> = (event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>) => void;

/** True when there's a ghost remainder that can be accepted right now. */
function canAcceptGhost<T>(ctx: KeyContext<T>): boolean {
  return Boolean(ctx.ghost) && ctx.isInputFocused && ctx.filteredSuggestions.length > 0;
}

/** Commit a completed value: mark the ghost-complete flag, set + propagate, and close. */
function commitCompletion<T>(ctx: KeyContext<T>, newValue: string): void {
  ctx.setJustCompletedGhost(true);
  ctx.setInputValue(newValue);
  ctx.debouncedOnChange(newValue);
  ctx.setGhost('');
  ctx.setOpen(false);
  ctx.setActiveIndex(-1);
}

const onArrowDown = <T,>(event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  event.preventDefault();
  if (!ctx.open && ctx.filteredSuggestions.length > 0) {
    ctx.setOpen(true);
    ctx.setUserClosedDropdown(false);
  }
  const max = Math.min(ctx.filteredSuggestions.length - 1, ctx.maxVisibleItems - 1);
  ctx.setActiveIndex((prev) => (prev < max ? prev + 1 : prev));
};

const onArrowUp = <T,>(event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  event.preventDefault();
  ctx.setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
};

const onEnter = <T,>(event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  event.preventDefault();
  const inRange = ctx.open && ctx.activeIndex >= 0 && ctx.activeIndex < ctx.filteredSuggestions.length;
  if (inRange) {
    const selected = ctx.filteredSuggestions[ctx.activeIndex];
    if (selected) ctx.selectItem(selected);
  } else if (ctx.allowFreeText && ctx.inputValue.trim()) {
    ctx.setOpen(false);
  }
};

const onTab = <T,>(event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  // Tab completion preserves the user's typed case (input + ghost remainder).
  if (!canAcceptGhost(ctx)) return;
  event.preventDefault();
  commitCompletion(ctx, ctx.inputValue + ctx.ghost);
};

const onArrowRight = <T,>(event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  // ArrowRight completion uses the suggestion's original case.
  if (!canAcceptGhost(ctx)) return;
  event.preventDefault();
  const first = firstGhostSuggestion(
    ctx.filteredSuggestions,
    ctx.inputValue,
    ctx.getLabel,
    ctx.getSuggestionType,
  );
  commitCompletion(ctx, first ? ctx.getLabel(first) : ctx.inputValue);
};

const onEscape = <T,>(event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  event.preventDefault();
  ctx.setOpen(false);
  ctx.setActiveIndex(-1);
  ctx.setUserClosedDropdown(true);
  if (event.detail === 2) {
    // Double escape clears the value.
    ctx.setInputValue('');
    ctx.debouncedOnChange('');
  }
};

const onBackspace = <T,>(_event: React.KeyboardEvent<HTMLInputElement>, ctx: KeyContext<T>): void => {
  if (ctx.multiple && ctx.inputValue === '' && ctx.selectedItems.length > 0) {
    ctx.onSelectedItemsChange?.(ctx.selectedItems.slice(0, -1));
  }
};

const KEY_HANDLERS: Record<string, KeyHandler<unknown>> = {
  ArrowDown: onArrowDown,
  ArrowUp: onArrowUp,
  Enter: onEnter,
  Tab: onTab,
  ArrowRight: onArrowRight,
  Escape: onEscape,
  Backspace: onBackspace,
};

/** Dispatch a keydown to its handler (no-op during IME composition or unmapped keys). */
export function handleAutocompleteKey<T>(
  event: React.KeyboardEvent<HTMLInputElement>,
  composition: boolean,
  ctx: KeyContext<T>,
): void {
  if (composition) return;
  const handler = KEY_HANDLERS[event.key] as KeyHandler<T> | undefined;
  handler?.(event, ctx);
}
