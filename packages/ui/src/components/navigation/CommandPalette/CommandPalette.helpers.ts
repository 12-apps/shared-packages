import type Fuse from 'fuse.js';
import type React from 'react';

import type { PaletteCommand } from './CommandPalette.types';

// Without a query the list is the recent commands first, then the rest; with one
// it is whatever fuzzy search returns.
export const filterCommands = ({
  commands,
  searchQuery,
  fuse,
  showRecent,
  recentCommandIds,
}: {
  commands: PaletteCommand[];
  searchQuery: string;
  fuse: Fuse<PaletteCommand>;
  showRecent?: boolean;
  recentCommandIds: string[];
}): PaletteCommand[] => {
  if (searchQuery) {
    return fuse.search(searchQuery).map((result) => result.item);
  }

  if (!showRecent || recentCommandIds.length === 0) {
    return commands;
  }

  const recent = recentCommandIds
    .map((id) => commands.find((command) => command.id === id))
    .filter(Boolean) as PaletteCommand[];

  return [...recent, ...commands.filter((command) => !recentCommandIds.includes(command.id))];
};

export const groupByCategory = (commands: PaletteCommand[]): Record<string, PaletteCommand[]> => {
  const groups: Record<string, PaletteCommand[]> = {};

  for (const command of commands) {
    const category = command.category || 'General';
    groups[category] = groups[category] ?? [];
    groups[category].push(command);
  }

  return groups;
};

// Arrow keys move the highlight, Enter runs the highlighted command, Escape
// closes. Built outside the effect so the switch does not count against the
// component body.
export const createPaletteKeyHandler = ({
  commandCount,
  selectedCommand,
  setSelectedIndex,
  executeCommand,
  onClose,
}: {
  commandCount: number;
  selectedCommand?: PaletteCommand;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  executeCommand: (command: PaletteCommand) => void;
  onClose: () => void;
}) => (event: globalThis.KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      setSelectedIndex((prev) => (prev < commandCount - 1 ? prev + 1 : prev));
      break;
    case 'ArrowUp':
      event.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      break;
    case 'Enter':
      event.preventDefault();
      if (selectedCommand) executeCommand(selectedCommand);
      break;
    case 'Escape':
      event.preventDefault();
      onClose();
      break;
  }
};
