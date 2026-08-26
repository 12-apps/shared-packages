import RecentIcon from '@mui/icons-material/History';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { alpha, styled } from '@mui/material/styles';
import React from 'react';

import { ShortcutChip } from './ShortcutChip';
import type { PaletteCommand } from './CommandPalette.types';
import type { CommandPaletteCopy } from '../../../copy';

const ResultsList = styled(List)(({ theme }) => ({
  maxHeight: 400,
  overflowY: 'auto',
  padding: theme.spacing(1),
  '&::-webkit-scrollbar': {
    width: 8,
  },
  '&::-webkit-scrollbar-track': {
    background: alpha(theme.palette.action.disabled, 0.1),
  },
  '&::-webkit-scrollbar-thumb': {
    background: alpha(theme.palette.primary.main, 0.3),
    borderRadius: 4,
    '&:hover': {
      background: alpha(theme.palette.primary.main, 0.5),
    },
  },
}));

const CommandItem = styled(ListItem)<{ selected?: boolean }>(({ theme, selected }) => ({
  borderRadius: theme.shape.borderRadius,
  marginBottom: theme.spacing(0.5),
  transition: theme.transitions.create(['background-color', 'transform']),
  cursor: 'pointer',
  ...(selected && {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    transform: 'translateX(4px)',
    '& .MuiListItemIcon-root': {
      color: theme.palette.primary.main,
    },
  }),
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
}));

const CategoryLabel = styled(Typography)(({ theme }) => ({
  fontSize: '0.75rem',
  fontWeight: 600,
  color: theme.palette.text.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  padding: theme.spacing(1, 2, 0.5, 2),
  marginTop: theme.spacing(1),
}));

const NoResults = styled(Box)(({ theme }) => ({
  padding: theme.spacing(4, 2),
  textAlign: 'center',
  color: theme.palette.text.secondary,
}));

const CommandRow: React.FC<{
  command: PaletteCommand;
  index: number;
  selected: boolean;
  dataTestId?: string;
  onSelect: (index: number) => void;
  onExecute: (command: PaletteCommand) => void;
}> = ({ command, index, selected, dataTestId, onSelect, onExecute }) => (
  <CommandItem
    data-index={index}
    data-testid={`${dataTestId}-item-${command.id}`}
    selected={selected}
    onClick={() => onExecute(command)}
    onMouseEnter={() => onSelect(index)}
  >
    {command.icon && <ListItemIcon sx={{ minWidth: 40 }}>{command.icon}</ListItemIcon>}
    <ListItemText
      primary={command.label}
      secondary={command.description}
      primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: selected ? 500 : 400 }}
      secondaryTypographyProps={{ fontSize: '0.75rem' }}
    />
    {command.shortcut && <ShortcutChip label={command.shortcut} size="small" />}
  </CommandItem>
);

const slug = (value: string) => value.toLowerCase().replace(/\s+/g, '-');

// The list, its recent section and the empty state. The running commandIndex
// has to stay consistent across both sections, so it is threaded through here
// rather than mutated from inside the render as it was before.
export const PaletteResults: React.FC<{
  copy: CommandPaletteCopy;
  listRef: React.Ref<globalThis.HTMLUListElement>;
  dataTestId?: string;
  searchQuery: string;
  showRecent?: boolean;
  commands: PaletteCommand[];
  recentCommandIds: string[];
  filteredCommands: PaletteCommand[];
  groupedCommands: Record<string, PaletteCommand[]>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onExecute: (command: PaletteCommand) => void;
}> = ({
  copy,
  listRef,
  dataTestId,
  searchQuery,
  showRecent,
  commands,
  recentCommandIds,
  filteredCommands,
  groupedCommands,
  selectedIndex,
  onSelect,
  onExecute,
}) => {
  if (filteredCommands.length === 0) {
    return (
      <NoResults data-testid={`${dataTestId}-no-results`}>
        <Typography variant="body2" color="text.secondary">
          No commands found for "{searchQuery}"
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ mt: 1 }}>
          {copy.tryAnotherTerm}
        </Typography>
      </NoResults>
    );
  }

  const showRecentSection = !searchQuery && showRecent && recentCommandIds.length > 0;
  const recent = showRecentSection
    ? (recentCommandIds
        .map((id) => commands.find((command) => command.id === id))
        .filter(Boolean) as PaletteCommand[])
    : [];

  // One running index across both sections, so keyboard selection lines up with
  // what is on screen.
  let commandIndex = 0;
  const row = (command: PaletteCommand) => {
    const index = commandIndex++;
    return (
      <CommandRow
        key={command.id}
        command={command}
        index={index}
        selected={index === selectedIndex}
        dataTestId={dataTestId}
        onSelect={onSelect}
        onExecute={onExecute}
      />
    );
  };

  const showCategoryLabels = Object.keys(groupedCommands).length > 1;

  return (
    <ResultsList ref={listRef} data-testid={`${dataTestId}-list`}>
      {showRecentSection && (
        <>
          <CategoryLabel data-testid={`${dataTestId}-group-recent`}>
            <RecentIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
            {copy.recent}
          </CategoryLabel>
          {recent.map(row)}
          {filteredCommands.length > recentCommandIds.length && <Divider sx={{ my: 1 }} />}
        </>
      )}

      {Object.entries(groupedCommands).map(([category, categoryCommands]) => (
        <Box key={category} data-testid={`${dataTestId}-group-${slug(category)}`}>
          {showCategoryLabels && (
            <CategoryLabel data-testid={`${dataTestId}-group-label-${slug(category)}`}>
              {category}
            </CategoryLabel>
          )}
          {categoryCommands.map(row)}
        </Box>
      ))}
    </ResultsList>
  );
};
