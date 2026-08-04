import Fuse from 'fuse.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createPaletteKeyHandler,
  filterCommands,
  groupByCategory,
} from './CommandPalette.helpers';
import type { PaletteCommand } from './CommandPalette.types';

const RECENT_LIMIT = 5;
const FOCUS_DELAY_MS = 100;

// The fuzzy index and the two derived lists it feeds.
const useCommandSearch = ({
  commands,
  searchQuery,
  showRecent,
  recentCommandIds,
}: {
  commands: PaletteCommand[];
  searchQuery: string;
  showRecent?: boolean;
  recentCommandIds: string[];
}) => {
  const fuse = useMemo(
    () =>
      new Fuse(commands, {
        keys: ['label', 'description', 'keywords', 'category'],
        threshold: 0.3,
        includeScore: true,
      }),
    [commands],
  );

  const filteredCommands = useMemo(
    () => filterCommands({ commands, searchQuery, fuse, showRecent, recentCommandIds }),
    [searchQuery, commands, fuse, showRecent, recentCommandIds],
  );

  const groupedCommands = useMemo(() => groupByCategory(filteredCommands), [filteredCommands]);

  return { filteredCommands, groupedCommands };
};

// Running a command records it as recent, fires the caller's callback and closes
// the palette.
const useExecuteCommand = ({
  setRecentCommandIds,
  onCommandExecute,
  onClose,
}: {
  setRecentCommandIds: React.Dispatch<React.SetStateAction<string[]>>;
  onCommandExecute?: (command: PaletteCommand) => void;
  onClose: () => void;
}) =>
  useCallback(
    (command: PaletteCommand) => {
      setRecentCommandIds((prev) =>
        [command.id, ...prev.filter((id) => id !== command.id)].slice(0, RECENT_LIMIT),
      );

      command.action();
      onCommandExecute?.(command);
      onClose();
    },
    [setRecentCommandIds, onCommandExecute, onClose],
  );

// The highlight resets on every new query; opening the palette focuses the input
// and closing it clears the query.
const useSelectionReset = ({
  open,
  searchQuery,
  searchInputRef,
  setSearchQuery,
  setSelectedIndex,
}: {
  open: boolean;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
}) => {
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, setSelectedIndex]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, FOCUS_DELAY_MS);
      return;
    }

    setSearchQuery('');
    setSelectedIndex(0);
  }, [open, searchInputRef, setSearchQuery, setSelectedIndex]);
};

// Global key handling while the palette is open, plus keeping the highlighted
// row scrolled into view.
const usePaletteKeyboard = ({
  open,
  selectedIndex,
  filteredCommands,
  listRef,
  setSelectedIndex,
  executeCommand,
  onClose,
}: {
  open: boolean;
  selectedIndex: number;
  filteredCommands: PaletteCommand[];
  listRef: React.RefObject<globalThis.HTMLUListElement | null>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  executeCommand: (command: PaletteCommand) => void;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = createPaletteKeyHandler({
      commandCount: filteredCommands.length,
      selectedCommand: filteredCommands[selectedIndex],
      setSelectedIndex,
      executeCommand,
      onClose,
    });

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, selectedIndex, filteredCommands, setSelectedIndex, executeCommand, onClose]);

  useEffect(() => {
    const selectedElement = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    ) as HTMLElement | null;

    selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedIndex, listRef]);
};

// All of the palette's state: the query, the highlighted row, the derived lists
// and the effects that keep them in sync. Grouped here so the exported component
// is prop defaults plus markup.
export const useCommandPalette = ({
  open,
  commands,
  showRecent,
  recentCommands,
  onCommandExecute,
  onClose,
}: {
  open: boolean;
  commands: PaletteCommand[];
  showRecent?: boolean;
  recentCommands: string[];
  onCommandExecute?: (command: PaletteCommand) => void;
  onClose: () => void;
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(recentCommands);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<globalThis.HTMLUListElement>(null);

  const { filteredCommands, groupedCommands } = useCommandSearch({
    commands,
    searchQuery,
    showRecent,
    recentCommandIds,
  });

  const executeCommand = useExecuteCommand({ setRecentCommandIds, onCommandExecute, onClose });

  useSelectionReset({ open, searchQuery, searchInputRef, setSearchQuery, setSelectedIndex });

  usePaletteKeyboard({
    open,
    selectedIndex,
    filteredCommands,
    listRef,
    setSelectedIndex,
    executeCommand,
    onClose,
  });

  return {
    searchQuery,
    setSearchQuery,
    selectedIndex,
    setSelectedIndex,
    searchInputRef,
    listRef,
    filteredCommands,
    groupedCommands,
    executeCommand,
    recentCommandIds,
  };
};
