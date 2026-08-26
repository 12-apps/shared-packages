import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import Fade from '@mui/material/Fade';
import Grow from '@mui/material/Grow';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import React, { useMemo } from 'react';

import { resolveCommandProps, useCommandPalette } from './Command.hooks';
import { CommandEmpty, CommandLoading } from './Command.parts';
import { commandPaperStyles, commandSizeStyles } from './Command.styles';
import type {
  CommandGroupProps,
  CommandInputProps,
  CommandItem,
  CommandItemProps,
  CommandListProps,
  CommandProps,
} from './Command.types';

export { CommandEmpty, CommandLoading, CommandSeparator } from './Command.parts';

const makeTestId = (dataTestId?: string) => (suffix: string) =>
  dataTestId ? `${dataTestId}-${suffix}` : undefined;

export const Command: React.FC<CommandProps> = (rawProps) => {
  const props = resolveCommandProps(rawProps);
  const { open, onOpenChange, variant, dataTestId } = props;
  const theme = useTheme();
  const testId = makeTestId(dataTestId);

  const { internalValue, filteredItems, highlightedId, handleValueChange, handleSelect, handleKeyDown } =
    useCommandPalette(props);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange?.(false)}
      maxWidth={false}
      PaperProps={{
        sx: {
          ...commandPaperStyles(theme, props),
          ...commandSizeStyles(props.size),
          overflow: 'hidden',
          ...props.style,
        },
        className: props.className,
        'data-testid': dataTestId,
      }}
      TransitionComponent={variant === 'glass' ? Fade : Grow}
      onClick={props.onClick}
    >
      <Box sx={{ p: 0 }}>
        <CommandInput
          placeholder={props.placeholder}
          value={internalValue}
          onChange={handleValueChange}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          onKeyDown={handleKeyDown}
          dataTestId={testId('input')}
        />

        <Divider />

        <DialogContent sx={{ p: 0, maxHeight: props.maxHeight, overflow: 'auto' }}>
          <CommandBody
            loading={props.loading}
            items={filteredItems}
            value={internalValue}
            emptyMessage={props.emptyMessage}
            onSelect={handleSelect}
            selectedId={highlightedId}
            showCategories={props.showCategories}
            showShortcuts={props.showShortcuts}
            showDescriptions={props.showDescriptions}
            testId={testId}
          />
          {props.children}
        </DialogContent>
      </Box>
    </Dialog>
  );
};

type CommandBodyProps = Pick<
  CommandListProps,
  'items' | 'value' | 'onSelect' | 'selectedId' | 'showCategories' | 'showShortcuts' | 'showDescriptions'
> & {
  loading: boolean;
  emptyMessage: string;
  testId: (suffix: string) => string | undefined;
};

/** Three mutually exclusive states share the scrolling area: busy, empty, or a list. */
const CommandBody: React.FC<CommandBodyProps> = ({ loading, emptyMessage, testId, ...list }) => {
  if (loading) {
    return <CommandLoading dataTestId={testId('loading')} />;
  }

  if (!list.items?.length) {
    return <CommandEmpty message={emptyMessage} dataTestId={testId('empty')} />;
  }

  return <CommandList {...list} dataTestId={testId('list')} />;
};

export const CommandInput: React.FC<CommandInputProps> = ({
  placeholder,
  value,
  onChange,
  onFocus,
  onBlur,
  disabled,
  autoFocus,
  onKeyDown,
  className,
  style,
  dataTestId,
}) => (
    <TextField
      fullWidth
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      variant="standard"
      className={className}
      inputProps={{
        'data-testid': dataTestId,
      }}
      sx={{
        p: 2,
        '& .MuiInput-underline:before': { border: 'none' },
        '& .MuiInput-underline:after': { border: 'none' },
        ...style,
      }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon />
          </InputAdornment>
        ),
        endAdornment: value && (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => onChange?.('')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );

export const CommandList: React.FC<CommandListProps> = ({
  items = [],
  onSelect,
  selectedId,
  emptyMessage,
  showCategories,
  showShortcuts,
  showDescriptions,
  loading,
  className,
  style,
  dataTestId,
}) => {
  const groupedItems = useMemo(() => {
    if (!showCategories) return { '': items };

    const groups: Record<string, CommandItem[]> = {};
    items.forEach(item => {
      const category = item.category || '';
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });
    return groups;
  }, [items, showCategories]);

  if (loading) return <CommandLoading dataTestId={dataTestId ? `${dataTestId}-loading` : undefined} />;
  if (items.length === 0) return <CommandEmpty message={emptyMessage} dataTestId={dataTestId ? `${dataTestId}-empty` : undefined} />;

  return (
    <List className={className} sx={style} data-testid={dataTestId}>
      {Object.entries(groupedItems).map(([category, categoryItems]) => (
        <CommandGroup
          key={category}
          heading={category}
          items={categoryItems}
          onSelect={onSelect}
          selectedId={selectedId}
          showShortcuts={showShortcuts}
          showDescriptions={showDescriptions}
        />
      ))}
    </List>
  );
};

export const CommandGroup: React.FC<CommandGroupProps> = ({
  heading,
  items = [],
  onSelect,
  selectedId,
  showShortcuts,
  showDescriptions,
  className,
  style,
  dataTestId,
}) => {
  const groupTestId = dataTestId || (heading ? `command-group-${heading}` : undefined);

  return (
    <Box className={className} sx={style} data-testid={groupTestId}>
      {heading && (
        <Typography
          variant="caption"
          sx={{
            px: 2,
            py: 1,
            display: 'block',
            color: 'text.secondary',
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {heading}
        </Typography>
      )}
      {items.map((item) => (
        <CommandItemComponent
          key={item.id}
          {...item}
          selected={selectedId === item.id}
          onSelect={() => onSelect?.(item)}
          showShortcut={showShortcuts}
          showDescription={showDescriptions}
          dataTestId={`command-item-${item.id}`}
        />
      ))}
    </Box>
  );
};

const CommandItemComponent: React.FC<CommandItemProps> = ({
  label,
  description,
  icon,
  shortcut,
  disabled,
  selected,
  onSelect,
  showShortcut,
  showDescription,
  className,
  style,
  dataTestId,
}) => {
  const theme = useTheme();

  return (
    <ListItemButton
      onClick={onSelect}
      disabled={disabled}
      selected={selected}
      className={className}
      data-testid={dataTestId}
      sx={{
        py: 1.5,
        px: 2,
        '&:hover': {
          backgroundColor: alpha(theme.palette.primary.main, 0.08),
        },
        '&.Mui-selected': {
          backgroundColor: alpha(theme.palette.primary.main, 0.12),
          '&:hover': {
            backgroundColor: alpha(theme.palette.primary.main, 0.16),
          },
        },
        ...style,
      }}
    >
      {icon && (
        <ListItemIcon sx={{ minWidth: 40 }}>
          {icon}
        </ListItemIcon>
      )}

      <ListItemText
        primary={label}
        secondary={showDescription && description}
        primaryTypographyProps={{
          fontSize: '0.875rem',
          fontWeight: selected ? 600 : 400,
        }}
        secondaryTypographyProps={{
          fontSize: '0.75rem',
        }}
      />

      {showShortcut && shortcut && (
        <Chip
          label={shortcut}
          size="small"
          variant="outlined"
          sx={{
            height: 20,
            fontSize: '0.7rem',
            ml: 1,
          }}
        />
      )}
    </ListItemButton>
  );
};
