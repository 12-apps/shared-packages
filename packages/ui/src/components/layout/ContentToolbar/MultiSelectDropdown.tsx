'use client';

import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
  Checkbox,
  Divider,
  InputAdornment,
  ListSubheader,
  Menu,
  MenuItem,
  TextField,
} from '@mui/material';
import React, { useMemo, useState } from 'react';

import type {
  MultiSelectDropdownProps,
  MultiSelectExtraOption,
  MultiSelectOption,
} from './ContentToolbar.types';
import { buildTriggerLabel, InlineTrigger, PillTrigger, StackedTrigger } from './MultiSelectTriggers';

/** One checkbox menu row with an optional trailing count. */
function CheckboxRow({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onToggle: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <MenuItem onClick={() => onToggle(!checked)} sx={{ gap: 1 }}>
      <Checkbox checked={checked} size="small" disableRipple sx={{ p: 0, pointerEvents: 'none' }} tabIndex={-1} />
      <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        {label}
        {count != null && (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {' '}
            ({count})
          </Box>
        )}
      </Box>
    </MenuItem>
  );
}

/**
 * Generic multi-select dropdown with checkboxes, counts, an optional "Options"
 * section, and a "Clear" action. Faithful MUI port of the reference toolbar's
 * "Content Type" control. The menu stays open while toggling options.
 */
export function MultiSelectDropdown<TValue extends string = string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  allLabel = 'All',
  extraOptions,
  searchable,
  searchPlaceholder = 'Search…',
  noResultsLabel = 'No results',
  layout = 'inline',
  'data-testid': testId,
  onOpenChange,
}: MultiSelectDropdownProps<TValue>): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const open = Boolean(anchorEl);
  const stacked = layout === 'stacked';
  // Reset the query each time the menu closes so it reopens showing everything.
  const close = (): void => {
    setAnchorEl(null);
    setQuery('');
    onOpenChange?.(false);
  };
  const triggerLabel = buildTriggerLabel(selected, options, allLabel);
  // Auto-enable search for long lists (e.g. many categories) unless overridden.
  const showSearch = searchable ?? options.length > 8;
  const anyExtraChecked = extraOptions?.some((option) => option.checked) ?? false;
  const clearDisabled = selected.size === 0 && !anyExtraChecked;

  const openMenu = (event: React.MouseEvent<HTMLElement>): void => {
    setAnchorEl(event.currentTarget);
    onOpenChange?.(true);
  };
  const triggerProps = { triggerLabel, open, onOpen: openMenu, testId };

  const renderTrigger = (): React.JSX.Element => {
    if (stacked) return <StackedTrigger label={label} {...triggerProps} />;
    if (layout === 'pill')
      return (
        <PillTrigger
          label={label}
          selectedCount={selected.size}
          onClear={onClear}
          {...triggerProps}
        />
      );
    return <InlineTrigger label={label} {...triggerProps} />;
  };

  return (
    <>
      {renderTrigger()}
      <MultiSelectMenu
        anchorEl={anchorEl}
        open={open}
        close={close}
        options={options}
        selected={selected}
        onToggle={onToggle}
        extraOptions={extraOptions}
        clearDisabled={clearDisabled}
        onClear={onClear}
        showSearch={showSearch}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={searchPlaceholder}
        noResultsLabel={noResultsLabel}
        matchAnchorWidth={stacked}
        testId={testId}
      />
    </>
  );
}

/** Sticky search box at the top of the menu; keydowns don't reach the Menu's typeahead. */
function MenuSearchField({
  query,
  onQueryChange,
  placeholder,
  testId,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  testId?: string;
}): React.JSX.Element {
  return (
    <Box
      sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', px: 1, py: 0.75 }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <TextField
        autoFocus
        size="small"
        fullWidth
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        inputProps={{ 'aria-label': placeholder, 'data-testid': testId ? `${testId}-search` : undefined }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16 }} />
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
}

interface MultiSelectMenuProps<TValue extends string> {
  anchorEl: HTMLElement | null;
  open: boolean;
  close: () => void;
  options: MultiSelectOption<TValue>[];
  selected: ReadonlySet<TValue>;
  onToggle: (value: TValue, checked: boolean) => void;
  extraOptions?: MultiSelectExtraOption[];
  clearDisabled: boolean;
  onClear: () => void;
  showSearch: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder: string;
  noResultsLabel: string;
  /** Match the menu width to the trigger and left-align it (stacked select). */
  matchAnchorWidth?: boolean;
  testId?: string;
}

/**
 * Menu placement. Default: anchored to the trigger's right (toolbar). When
 * `matchAnchorWidth` (stacked select), match the trigger width and left-align so
 * the menu sits flush under the full-width control.
 */
function resolveMenuPlacement(
  matchAnchorWidth: boolean | undefined,
  anchorEl: HTMLElement | null,
): { anchorWidth: number | undefined; align: 'left' | 'right' } {
  if (!matchAnchorWidth) return { anchorWidth: undefined, align: 'right' };
  return { anchorWidth: anchorEl?.offsetWidth, align: 'left' };
}

/** The (optional) search box + checkbox list + optional "Options" section + a "Clear" footer. */
function MultiSelectMenu<TValue extends string>({
  anchorEl,
  open,
  close,
  options,
  selected,
  onToggle,
  extraOptions,
  clearDisabled,
  onClear,
  showSearch,
  query,
  onQueryChange,
  searchPlaceholder,
  noResultsLabel,
  matchAnchorWidth,
  testId,
}: MultiSelectMenuProps<TValue>): React.JSX.Element {
  const trimmed = query.trim().toLowerCase();
  const visibleOptions = useMemo(
    () => (trimmed ? options.filter((option) => option.label.toLowerCase().includes(trimmed)) : options),
    [options, trimmed],
  );
  const { anchorWidth, align } = resolveMenuPlacement(matchAnchorWidth, anchorEl);
  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: align }}
      transformOrigin={{ vertical: 'top', horizontal: align }}
      // Keep focus on the search box (don't let the Menu grab the first item),
      // and stop MUI's typeahead from swallowing keystrokes meant for the input.
      autoFocus={!showSearch}
      disableAutoFocusItem
      slotProps={{
        // Cap the height so a long list (e.g. many categories) scrolls instead
        // of running off-screen; the sticky search box stays pinned on top.
        paper: { sx: { minWidth: anchorWidth ?? 180, width: anchorWidth, maxHeight: 360 } },
        list: { sx: { pt: showSearch ? 0 : undefined, pb: 0 } },
      }}
    >
      {showSearch && (
        <MenuSearchField query={query} onQueryChange={onQueryChange} placeholder={searchPlaceholder} testId={testId} />
      )}
      {visibleOptions.length === 0 && showSearch ? (
        <MenuItem disabled data-testid={testId ? `${testId}-no-results` : undefined} sx={{ fontSize: '0.8125rem' }}>
          {noResultsLabel}
        </MenuItem>
      ) : (
        visibleOptions.map((option) => (
          <CheckboxRow
            key={option.value}
            label={option.label}
            count={option.count}
            checked={selected.has(option.value)}
            onToggle={(next) => onToggle(option.value, next)}
          />
        ))
      )}
      {extraOptions && extraOptions.length > 0
        ? [
            <Divider key="extra-divider" />,
            <ListSubheader key="extra-label" sx={{ px: 1, py: 0.75, fontSize: '0.75rem', fontWeight: 600 }}>
              Options
            </ListSubheader>,
            ...extraOptions.map((extra) => (
              <CheckboxRow key={extra.id} label={extra.label} checked={extra.checked} onToggle={(next) => extra.onCheckedChange(next)} />
            )),
          ]
        : null}
      <MenuClearFooter clearDisabled={clearDisabled} onClear={onClear} close={close} testId={testId} />
    </Menu>
  );
}

/** The bottom "Clear" footer that resets the selection and closes the menu. */
function MenuClearFooter({
  clearDisabled,
  onClear,
  close,
  testId,
}: {
  clearDisabled: boolean;
  onClear: () => void;
  close: () => void;
  testId?: string;
}): React.JSX.Element {
  return (
    <Box
      sx={{
        // Pin to the bottom of the scroll viewport so it stays visible while the
        // options list scrolls (mirrors the sticky search box on top).
        position: 'sticky',
        bottom: 0,
        zIndex: 1,
        display: 'flex',
        justifyContent: 'flex-end',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        px: 1,
        py: 0.75,
      }}
    >
      <Button
        variant="text"
        size="small"
        color="inherit"
        data-testid={testId ? `${testId}-clear` : undefined}
        disabled={clearDisabled}
        onClick={() => {
          onClear();
          close();
        }}
        sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: '0.75rem', fontWeight: 400, textTransform: 'none', color: 'text.secondary' }}
      >
        Clear
      </Button>
    </Box>
  );
}
