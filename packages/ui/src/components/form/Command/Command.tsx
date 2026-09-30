import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box/index.js';
import Chip from '@mui/material/Chip/index.js';
import Dialog from '@mui/material/Dialog/index.js';
import DialogContent from '@mui/material/DialogContent/index.js';
import Divider from '@mui/material/Divider/index.js';
import Fade from '@mui/material/Fade/index.js';
import Grow from '@mui/material/Grow/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import InputAdornment from '@mui/material/InputAdornment/index.js';
import List from '@mui/material/List/index.js';
import ListItemButton from '@mui/material/ListItemButton/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import TextField from '@mui/material/TextField/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme, type Theme } from '@mui/material/styles/index.js';
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
import { rem, sxRem } from '../../../tokens/relative';

export { CommandEmpty, CommandLoading, CommandSeparator } from './Command.parts';

/**
 * The list's `maxHeight`: a number is design px (400 when unset), read through
 * the type scale; a string is any CSS length, and a number ≤ 1 stays the
 * fraction `sx` reads it as (an `sx` callback's result still goes through the
 * sizing transform).
 */
const contentMaxHeight = (theme: Theme, value: number | string = 400): number | string =>
  typeof value === 'number' && value > 1 ? rem(theme, value) : value;

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
          ...commandSizeStyles(theme, props.size),
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

        <DialogContent sx={{ p: 0, maxHeight: (t: Theme) => contentMaxHeight(t, props.maxHeight), overflow: 'auto' }}>
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
        <ListItemIcon sx={{ minWidth: sxRem(40) }}>
          {icon}
        </ListItemIcon>
      )}

      <ListItemText
        primary={label}
        secondary={showDescription && description}
        primaryTypographyProps={{
          fontSize: rem(theme, 14),
          fontWeight: selected ? 600 : 400,
        }}
        secondaryTypographyProps={{
          fontSize: rem(theme, 12),
        }}
      />

      {showShortcut && shortcut && (
        <Chip
          label={shortcut}
          size="small"
          variant="outlined"
          sx={{
            height: sxRem(20),
            fontSize: rem(theme, 11.2),
            ml: 1,
          }}
        />
      )}
    </ListItemButton>
  );
};
