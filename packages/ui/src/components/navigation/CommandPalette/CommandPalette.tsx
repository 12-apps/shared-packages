import CloseIcon from '@mui/icons-material/Close';
import EnterIcon from '@mui/icons-material/KeyboardReturn';
import SearchIcon from '@mui/icons-material/Search';
import {
  alpha,
  Box,
  Dialog,
  DialogContent,
  IconButton,
  InputBase,
  Paper,
  Slide,
  styled,
  Typography,
  useTheme } from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import type { FC} from 'react';
import React, {  } from 'react';

import { useCommandPalette } from './CommandPalette.hooks';
import { PaletteResults } from './CommandPaletteResults';
import { ShortcutChip } from './ShortcutChip';
import type { CommandPaletteProps } from './CommandPalette.types';
import type { CommandPaletteCopy } from '../../../copy';

// Styled components
const StyledDialog = styled(Dialog)(() => ({
  '& .MuiBackdrop-root': {
    backgroundColor: alpha('#000', 0.6),
    backdropFilter: 'blur(4px)' },
  '& .MuiDialog-paper': {
    position: 'fixed',
    top: '20%',
    margin: 0,
    maxHeight: 'none',
    background: 'transparent',
    boxShadow: 'none',
    overflow: 'visible' } }));

const PaletteContainer = styled(Paper)(({ theme }) => ({
  width: '100%',
  maxWidth: 640,
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  borderRadius: theme.shape.borderRadius * 2,
  overflow: 'hidden',
  boxShadow: theme.shadows[24] }));

const SearchContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
  background: alpha(theme.palette.background.default, 0.4) }));

const SearchInput = styled(InputBase)(({ theme }) => ({
  flex: 1,
  fontSize: '1.125rem',
  fontWeight: 400,
  '& input': {
    padding: theme.spacing(0, 1),
    '&::placeholder': {
      color: theme.palette.text.secondary,
      opacity: 0.8 } } }));

const Transition = React.forwardRef<unknown, TransitionProps & { children: React.ReactElement }>(
  function Transition(props, ref) {
    return <Slide direction="down" ref={ref} {...props} />;
  },
);

// Main component
const PaletteSearch: React.FC<{
  inputRef: React.Ref<HTMLInputElement>;
  placeholder?: string;
  value: string;
  dataTestId?: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}> = ({ inputRef, placeholder, value, dataTestId, onChange, onClose }) => (
  <SearchContainer>
    <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />
    <SearchInput
      ref={inputRef}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck="false"
      inputProps={{ 'data-testid': `${dataTestId}-input` }}
    />
    <IconButton size="small" onClick={onClose} sx={{ ml: 1 }}>
      <CloseIcon fontSize="small" />
    </IconButton>
  </SearchContainer>
);

const PaletteFooter: React.FC<{ commandCount: number; copy: CommandPaletteCopy }> = ({
  commandCount,
  copy,
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 1,
        borderTop: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
        background: alpha(theme.palette.background.default, 0.4) }}
    >
      <Box sx={{ display: 'flex', gap: 1 }}>
        <ShortcutChip
          icon={<EnterIcon sx={{ fontSize: 12 }} />}
          label={copy.execute}
          size="small"
        />
        <ShortcutChip label={copy.navigate} size="small" />
        <ShortcutChip label={copy.close} size="small" />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {commandCount} commands
      </Typography>
    </Box>
  );
};

export const CommandPalette: FC<CommandPaletteProps> = ({
  copy,
  open,
  onClose,
  commands,
  placeholder = 'Type a command or search...',
  width = '640px',
  maxHeight = '400px',
  showRecent = true,
  recentCommands = [],
  onCommandExecute,
  dataTestId = 'command-palette' }) => {
  const {
    searchQuery,
    setSearchQuery,
    selectedIndex,
    setSelectedIndex,
    searchInputRef,
    listRef,
    filteredCommands,
    groupedCommands,
    executeCommand,
    recentCommandIds } = useCommandPalette({
    open,
    commands,
    showRecent,
    recentCommands,
    onCommandExecute,
    onClose });

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  return (
    <StyledDialog
      open={open}
      onClose={onClose}
      TransitionComponent={Transition}
      maxWidth={false}
      fullWidth
      data-testid={dataTestId}
    >
      <DialogContent sx={{ overflow: 'visible', p: 0 }}>
        <PaletteContainer elevation={24} sx={{ width, maxHeight }}>
          <PaletteSearch
            inputRef={searchInputRef}
            placeholder={placeholder}
            value={searchQuery}
            dataTestId={dataTestId}
            onChange={handleSearchChange}
            onClose={onClose}
          />

          <PaletteResults
          copy={copy}
            listRef={listRef}
            dataTestId={dataTestId}
            searchQuery={searchQuery}
            showRecent={showRecent}
            commands={commands}
            recentCommandIds={recentCommandIds}
            filteredCommands={filteredCommands}
            groupedCommands={groupedCommands}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onExecute={executeCommand}
          />

          <PaletteFooter copy={copy} commandCount={filteredCommands.length} />
        </PaletteContainer>
      </DialogContent>
    </StyledDialog>
  );
};

// Export default
export default CommandPalette;
