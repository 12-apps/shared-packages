import { useEffect, useId, useRef, useState } from 'react';

import {
  defaultGetKey,
  defaultGetLabel,
  defaultGetSuggestionType,
  defaultGetUrl,
  defaultOpenLink,
  filterSuggestions,
  firstGhostSuggestion,
  type MatchMode,
} from './Autocomplete.helpers';
import { handleAutocompleteKey, type KeyContext } from './Autocomplete.keys';
import type { AutocompleteProps } from './Autocomplete.types';

type Setter<V> = React.Dispatch<React.SetStateAction<V>>;

/** All mutable state + refs for one Autocomplete instance. */
interface AutocompleteState<T> {
  open: boolean;
  setOpen: Setter<boolean>;
  activeIndex: number;
  setActiveIndex: Setter<number>;
  ghost: string;
  setGhost: Setter<string>;
  inputValue: string;
  setInputValue: Setter<string>;
  composition: boolean;
  setComposition: Setter<boolean>;
  filteredSuggestions: T[];
  setFilteredSuggestions: Setter<T[]>;
  isInputFocused: boolean;
  setIsInputFocused: Setter<boolean>;
  justCompletedGhost: boolean;
  setJustCompletedGhost: Setter<boolean>;
  userClosedDropdown: boolean;
  setUserClosedDropdown: Setter<boolean>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLUListElement | null>;
  debounceRef: React.RefObject<number | undefined>;
}

function useAutocompleteState<T>(value: string, suggestions: T[]): AutocompleteState<T> {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [ghost, setGhost] = useState('');
  const [inputValue, setInputValue] = useState(value);
  const [composition, setComposition] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<T[]>(suggestions);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [justCompletedGhost, setJustCompletedGhost] = useState(false);
  const [userClosedDropdown, setUserClosedDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  return {
    open, setOpen, activeIndex, setActiveIndex, ghost, setGhost, inputValue, setInputValue,
    composition, setComposition, filteredSuggestions, setFilteredSuggestions, isInputFocused,
    setIsInputFocused, justCompletedGhost, setJustCompletedGhost, userClosedDropdown,
    setUserClosedDropdown, inputRef, listRef, debounceRef,
  };
}

// ---- effects (one tiny hook each; explicit params keep deps complete) --------

function useValueSync(value: string, setInputValue: Setter<string>): void {
  useEffect(() => setInputValue(value), [value, setInputValue]);
}

function useDebounceCleanup(debounceRef: React.RefObject<number | undefined>): void {
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [debounceRef],
  );
}

function useScrollActiveIntoView(
  activeIndex: number,
  optionIdPrefix: string,
  listRef: React.RefObject<HTMLUListElement | null>,
): void {
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    document
      .getElementById(`${optionIdPrefix}-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, optionIdPrefix, listRef]);
}

function useGhostFlagReset(justCompletedGhost: boolean, setJustCompletedGhost: Setter<boolean>): void {
  useEffect(() => {
    if (!justCompletedGhost) return;
    const timer = setTimeout(() => setJustCompletedGhost(false), 50);
    return () => clearTimeout(timer);
  }, [justCompletedGhost, setJustCompletedGhost]);
}

function useLoadingOpen(
  isLoading: boolean,
  inputValue: string,
  disabled: boolean,
  setOpen: Setter<boolean>,
  setActiveIndex: Setter<number>,
): void {
  useEffect(() => {
    if (isLoading && inputValue.trim().length > 0 && !disabled) setOpen(true);
    if (disabled) {
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [isLoading, inputValue, disabled, setOpen, setActiveIndex]);
}

/** Inputs to the auto-open check, all primitive/stable so effect deps stay complete. */
interface AutoOpenArgs {
  inputValue: string;
  isInputFocused: boolean;
  composition: boolean;
  justCompletedGhost: boolean;
  userClosedDropdown: boolean;
  activeIndex: number;
  setOpen: Setter<boolean>;
  setActiveIndex: Setter<number>;
}

/** Auto-open the dropdown once local filtering has a fresh result set. */
function maybeAutoOpen(a: AutoOpenArgs, hasResults: boolean): void {
  const canAutoOpen =
    a.inputValue.trim() &&
    a.isInputFocused &&
    !a.composition &&
    !a.justCompletedGhost &&
    !a.userClosedDropdown;
  if (!canAutoOpen) return;
  a.setOpen(true);
  if (hasResults && a.activeIndex === -1) a.setActiveIndex(0);
}

function useLocalFilter<T>(p: AutocompleteProps<T>, s: AutocompleteState<T>): void {
  const propSuggestions = p.suggestions;
  const getLabel = p.getLabel ?? defaultGetLabel;
  const matchMode: MatchMode = p.matchMode ?? 'contains';
  const async = Boolean(p.async);
  const {
    inputValue, isInputFocused, composition, justCompletedGhost, userClosedDropdown, activeIndex,
    setFilteredSuggestions, setOpen, setActiveIndex,
  } = s;
  useEffect(() => {
    const suggestions = propSuggestions ?? [];
    if (async || !inputValue) {
      setFilteredSuggestions(suggestions);
      return;
    }
    const filtered = filterSuggestions(suggestions, inputValue, matchMode, getLabel);
    setFilteredSuggestions(filtered);
    maybeAutoOpen(
      { inputValue, isInputFocused, composition, justCompletedGhost, userClosedDropdown, activeIndex, setOpen, setActiveIndex },
      filtered.length > 0,
    );
  }, [
    propSuggestions, inputValue, async, getLabel, matchMode, isInputFocused, composition,
    justCompletedGhost, userClosedDropdown, activeIndex, setFilteredSuggestions, setOpen, setActiveIndex,
  ]);
}

function useGhostText<T>(p: AutocompleteProps<T>, s: AutocompleteState<T>): void {
  const getLabel = p.getLabel ?? defaultGetLabel;
  const getType = p.getSuggestionType ?? defaultGetSuggestionType;
  const showGhost = p.showGhostText ?? true;
  const { inputValue, filteredSuggestions, isInputFocused, composition, setGhost } = s;
  useEffect(() => {
    if (!inputValue || !isInputFocused || composition || !showGhost) {
      setGhost('');
      return;
    }
    const first = firstGhostSuggestion(filteredSuggestions, inputValue, getLabel, getType);
    setGhost(first ? getLabel(first).slice(inputValue.length) : '');
  }, [inputValue, filteredSuggestions, isInputFocused, composition, showGhost, getLabel, getType, setGhost]);
}

// ---- selection (split by mode to keep each function under the complexity bar) -

function commitMultiSelect<T>(item: T, p: AutocompleteProps<T>, s: AutocompleteState<T>, onChange: (v: string) => void): void {
  const getKey = p.getKey ?? defaultGetKey;
  const current = p.selectedItems ?? [];
  if (!current.some((sel) => getKey(sel) === getKey(item))) p.onSelectedItemsChange?.([...current, item]);
  s.setInputValue('');
  onChange('');
  s.setUserClosedDropdown(false);
}

function commitSingleSelect<T>(item: T, p: AutocompleteProps<T>, s: AutocompleteState<T>, onChange: (v: string) => void): void {
  const label = (p.getLabel ?? defaultGetLabel)(item);
  s.setInputValue(label);
  onChange(label);
}

function runSelectItem<T>(item: T, p: AutocompleteProps<T>, s: AutocompleteState<T>, onChange: (v: string) => void): void {
  const url = (p.getUrl ?? defaultGetUrl)(item);
  const isLink = (p.getSuggestionType ?? defaultGetSuggestionType)(item) === 'link' && Boolean(url);
  if (isLink) {
    (p.openLink ?? defaultOpenLink)(url as string, item);
  } else if (p.multiple) {
    commitMultiSelect(item, p, s, onChange);
  } else {
    commitSingleSelect(item, p, s, onChange);
  }
  s.setOpen(false);
  s.setActiveIndex(-1);
  p.onSelect?.(item);
  s.inputRef.current?.focus();
}

function buildKeyContext<T>(
  p: AutocompleteProps<T>,
  s: AutocompleteState<T>,
  selectItem: (item: T) => void,
  onChange: (v: string) => void,
): KeyContext<T> {
  return {
    open: s.open, activeIndex: s.activeIndex, filteredSuggestions: s.filteredSuggestions,
    maxVisibleItems: p.maxVisibleItems ?? 10, allowFreeText: p.allowFreeText ?? true,
    inputValue: s.inputValue, ghost: s.ghost, isInputFocused: s.isInputFocused,
    multiple: Boolean(p.multiple), selectedItems: p.selectedItems ?? [],
    getLabel: p.getLabel ?? defaultGetLabel,
    getSuggestionType: p.getSuggestionType ?? defaultGetSuggestionType,
    setOpen: s.setOpen, setActiveIndex: s.setActiveIndex, setUserClosedDropdown: s.setUserClosedDropdown,
    setInputValue: s.setInputValue, setGhost: s.setGhost, setJustCompletedGhost: s.setJustCompletedGhost,
    debouncedOnChange: onChange, selectItem, onSelectedItemsChange: p.onSelectedItemsChange,
  };
}

/** The full view-model the presentational component renders. */
export interface AutocompleteView<T> {
  id: string;
  listId: string;
  optionIdPrefix: string;
  state: AutocompleteState<T>;
  visibleSuggestions: T[];
  activeDescendant: string | undefined;
  selectItem: (item: T) => void;
  removeSelectedItem: (item: T) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onClickAway: () => void;
}

/** Wire state, effects, and (plain, per-render) handlers for the Autocomplete component. */
export function useAutocomplete<T>(p: AutocompleteProps<T>): AutocompleteView<T> {
  const componentId = useId();
  const id = p.id || componentId;
  const optionIdPrefix = `${id}-option`;
  const s = useAutocompleteState<T>(p.value, p.suggestions ?? []);

  const debouncedOnChange = (val: string): void => {
    if (s.debounceRef.current) window.clearTimeout(s.debounceRef.current);
    s.debounceRef.current = window.setTimeout(() => p.onChange(val), p.debounceMs ?? 150);
  };

  useValueSync(p.value, s.setInputValue);
  useDebounceCleanup(s.debounceRef);
  useScrollActiveIntoView(s.activeIndex, optionIdPrefix, s.listRef);
  useGhostFlagReset(s.justCompletedGhost, s.setJustCompletedGhost);
  useLoadingOpen(Boolean(p.isLoading), s.inputValue, Boolean(p.disabled), s.setOpen, s.setActiveIndex);
  useLocalFilter(p, s);
  useGhostText(p, s);

  const selectItem = (item: T): void => runSelectItem(item, p, s, debouncedOnChange);

  return {
    id,
    listId: `${id}-listbox`,
    optionIdPrefix,
    state: s,
    visibleSuggestions: s.filteredSuggestions.slice(0, p.maxVisibleItems ?? 10),
    activeDescendant: s.activeIndex >= 0 ? `${optionIdPrefix}-${s.activeIndex}` : undefined,
    selectItem,
    removeSelectedItem: (item: T): void => {
      const getKey = p.getKey ?? defaultGetKey;
      p.onSelectedItemsChange?.((p.selectedItems ?? []).filter((sel) => getKey(sel) !== getKey(item)));
      s.inputRef.current?.focus();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>): void =>
      handleAutocompleteKey(e, s.composition, buildKeyContext(p, s, selectItem, debouncedOnChange)),
    onInputChange: (e: React.ChangeEvent<HTMLInputElement>): void => {
      s.setInputValue(e.target.value);
      debouncedOnChange(e.target.value);
      if (!s.open || s.filteredSuggestions.length === 0) s.setActiveIndex(-1);
      s.setUserClosedDropdown(false);
    },
    onFocus: (): void => {
      s.setIsInputFocused(true);
      s.setUserClosedDropdown(false);
      if (!s.inputValue.trim()) return;
      s.setOpen(true);
      if (s.filteredSuggestions.length > 0 && s.activeIndex === -1) s.setActiveIndex(0);
    },
    onBlur: (): void => {
      window.setTimeout(() => s.setIsInputFocused(false), 150);
    },
    onClickAway: (): void => {
      s.setOpen(false);
      s.setActiveIndex(-1);
      s.setUserClosedDropdown(true);
    },
  };
}
