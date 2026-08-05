import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CommandItem, CommandProps } from './Command.types';

type CommandDefaultedKeys =
  | 'open'
  | 'items'
  | 'placeholder'
  | 'value'
  | 'variant'
  | 'size'
  | 'color'
  | 'glow'
  | 'pulse'
  | 'loading'
  | 'disabled'
  | 'maxHeight'
  | 'emptyMessage'
  | 'showCategories'
  | 'showShortcuts'
  | 'showDescriptions'
  | 'autoFocus'
  | 'closeOnSelect';

type ResolvedCommandProps = CommandProps &
  Required<Pick<CommandProps, CommandDefaultedKeys>>;

const COMMAND_DEFAULTS: Pick<CommandProps, CommandDefaultedKeys> = {
  open: false,
  items: [],
  placeholder: 'Type a command or search...',
  value: '',
  variant: 'default',
  size: 'md',
  color: 'primary',
  glow: false,
  pulse: false,
  loading: false,
  disabled: false,
  maxHeight: 400,
  emptyMessage: 'No results found',
  showCategories: true,
  showShortcuts: true,
  showDescriptions: true,
  autoFocus: true,
  closeOnSelect: true,
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: CommandProps): Partial<CommandProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<CommandProps>;

export const resolveCommandProps = (props: CommandProps): ResolvedCommandProps =>
  ({ ...COMMAND_DEFAULTS, ...definedProps(props) }) as ResolvedCommandProps;

/** An item matches on its label, its description, or any of its keywords. */
const matches = (item: CommandItem, search: string): boolean => {
  const searchTargets = [
    item.label.toLowerCase(),
    item.description?.toLowerCase(),
    ...(item.keywords || []).map((k) => k.toLowerCase()),
  ];
  return searchTargets.some((target) => target?.includes(search));
};

const useFilteredItems = (
  items: CommandItem[],
  search: string,
  customFilter: CommandProps['customFilter'],
) =>
  useMemo(() => {
    if (!search) return items;

    if (customFilter) {
      return items.filter((item) => customFilter(item, search));
    }

    const searchLower = search.toLowerCase();
    return items.filter((item) => matches(item, searchLower));
  }, [items, search, customFilter]);

/**
 * Kept as it was: the ref is never attached to an element, so this focus call has
 * always been a no-op. The input does get focus — CommandInput passes `autoFocus`
 * straight to its TextField — so removing it is a behaviour question, not a
 * cleanup, and is left alone here.
 */
const useAutoFocus = (open: boolean, autoFocus: boolean) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && autoFocus) {
      window.setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, autoFocus]);
};

interface NavigationArgs {
  items: CommandItem[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  onSelect: (item: CommandItem) => void;
  onClose: () => void;
}

/** Arrows wrap around the list; Enter takes the highlighted item, Escape closes. */
const useKeyboardNavigation = ({
  items,
  selectedIndex,
  setSelectedIndex,
  onSelect,
  onClose,
}: NavigationArgs) =>
  useCallback(
    (e: React.KeyboardEvent) => {
      const step = (delta: number) => {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + delta + items.length) % items.length);
      };

      switch (e.key) {
        case 'ArrowDown':
          return step(1);
        case 'ArrowUp':
          return step(-1);
        case 'Enter':
          e.preventDefault();
          if (items[selectedIndex]) {
            onSelect(items[selectedIndex]);
          }
          return;
        case 'Escape':
          e.preventDefault();
          onClose();
          return;
        default:
          return;
      }
    },
    [items, selectedIndex, setSelectedIndex, onSelect, onClose],
  );

export const useCommandPalette = (props: ResolvedCommandProps) => {
  const { open, items, value, autoFocus, customFilter } = props;
  const { onValueChange, onSelect, onOpenChange, closeOnSelect } = props;

  const [internalValue, setInternalValue] = useState(value);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useAutoFocus(open, autoFocus);

  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  const handleValueChange = useCallback(
    (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
      setSelectedIndex(0);
    },
    [onValueChange],
  );

  const filteredItems = useFilteredItems(items, internalValue, customFilter);

  // Arrow keys and Enter address the enabled items only, so a disabled row never
  // becomes the highlighted one.
  const selectableItems = useMemo(
    () => filteredItems.filter((item) => !item.disabled),
    [filteredItems],
  );

  const handleSelect = useCallback(
    (item: CommandItem) => {
      if (item.disabled) return;

      item.action?.();
      onSelect?.(item);

      if (closeOnSelect) {
        onOpenChange?.(false);
        setInternalValue('');
      }
    },
    [onSelect, onOpenChange, closeOnSelect],
  );

  const handleKeyDown = useKeyboardNavigation({
    items: selectableItems,
    selectedIndex,
    setSelectedIndex,
    onSelect: handleSelect,
    onClose: () => onOpenChange?.(false),
  });

  return {
    internalValue,
    filteredItems,
    highlightedId: selectableItems[selectedIndex]?.id,
    handleValueChange,
    handleSelect,
    handleKeyDown,
  };
};
