import type React from 'react';
import type { CommandPaletteCopy } from '../../../copy';

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  category?: string;
  action: () => void;
  keywords?: string[];
}

export interface CommandPaletteProps {
  /** The footer's keyboard hints and the empty state's nudge. REQUIRED. */
  copy: CommandPaletteCopy;
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  placeholder?: string;
  width?: string;
  maxHeight?: string;
  showRecent?: boolean;
  recentCommands?: string[];
  onCommandExecute?: (command: PaletteCommand) => void;
  dataTestId?: string;
}
