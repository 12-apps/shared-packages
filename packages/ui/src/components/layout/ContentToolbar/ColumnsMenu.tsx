'use client';

import ColumnsIcon from '@mui/icons-material/ViewColumnRounded';
import { Box, Checkbox, IconButton, ListSubheader, Menu, MenuItem } from '@mui/material';
import React, { useState } from 'react';

import type { ColumnVisibilityOption, ColumnsMenuProps } from './ContentToolbar.types';

/** One column checkbox row; toggling never closes the menu. */
function ColumnRow({
  option,
  onToggle,
  testId,
}: {
  option: ColumnVisibilityOption;
  onToggle: (id: string, visible: boolean) => void;
  testId?: string;
}): React.JSX.Element {
  return (
    <MenuItem
      data-testid={testId}
      onClick={() => onToggle(option.id, !option.visible)}
      disabled={option.locked}
      sx={{ gap: 1 }}
    >
      <Checkbox
        checked={option.visible}
        size="small"
        disableRipple
        sx={{ p: 0, pointerEvents: 'none' }}
        tabIndex={-1}
      />
      <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        {option.label}
      </Box>
    </MenuItem>
  );
}

/**
 * Stateless column-visibility selector: a neutral icon button (matching
 * {@link FilterTrigger}/{@link SortByDropdown}) opening a checkbox list of the
 * hideable columns. Purely presentational — the caller owns the visibility state
 * and is notified via `onToggle`. The menu stays open while toggling so several
 * columns can be flipped at once.
 */
export function ColumnsMenu({
  columns,
  onToggle,
  title = 'Columns',
  ariaLabel = 'Toggle columns',
  'data-testid': testId,
}: ColumnsMenuProps): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const close = (): void => setAnchorEl(null);

  return (
    <>
      <IconButton
        size="small"
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{
          width: 32,
          height: 32,
          borderRadius: 1,
          color: 'text.secondary',
          bgcolor: open ? 'action.selected' : 'transparent',
        }}
      >
        <ColumnsIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <ListSubheader sx={{ px: 1.5, py: 0.75, fontSize: '0.75rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.5 }}>
          {title}
        </ListSubheader>
        {columns.map((option) => (
          <ColumnRow
            key={option.id}
            option={option}
            onToggle={onToggle}
            testId={testId ? `${testId}-${option.id}` : undefined}
          />
        ))}
      </Menu>
    </>
  );
}
