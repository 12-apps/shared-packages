'use client';

import CheckIcon from '@mui/icons-material/Check';
import ChevronDownIcon from '@mui/icons-material/KeyboardArrowDown';
import GridIcon from '@mui/icons-material/GridViewOutlined';
import ListIcon from '@mui/icons-material/FormatListBulletedRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
// `SvgIconComponent` is declared inline in @mui/icons-material's barrel and has
// no module of its own, so the deep-import equivalent is its own definition:
// `type SvgIconComponent = typeof SvgIcon`.
import type SvgIcon from '@mui/material/SvgIcon';
import React, { useState } from 'react';

import type { ViewMode, ViewSelectorProps } from './ContentToolbar.types';

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: typeof SvgIcon }[] = [
  { value: 'grid', label: 'Grid View', icon: GridIcon },
  { value: 'list', label: 'List View', icon: ListIcon },
];

/**
 * View selector: a grid/list dropdown plus a card-size zoom slider (grid mode
 * only). Faithful MUI port of the reference toolbar's view control.
 */
export function ViewSelector({
  viewMode,
  onViewModeChange,
  zoom,
  onZoomChange,
  cardSizeLabel,
}: ViewSelectorProps): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const activeOption = VIEW_OPTIONS.find((option) => option.value === viewMode) ?? VIEW_OPTIONS[0]!;
  const ActiveIcon = activeOption.icon;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      {viewMode === 'grid' && (
        <Box sx={{ width: 96, display: 'flex', alignItems: 'center' }}>
          <Slider
            data-testid="resize-card-slider"
            aria-label={cardSizeLabel}
            value={zoom[0] ?? 0}
            onChange={(_, value) => onZoomChange([value as number])}
            min={0}
            max={100}
            step={1}
            size="small"
          />
        </Box>
      )}

      <Button
        data-testid="view-mode-btn"
        variant="text"
        size="small"
        color="inherit"
        aria-label={activeOption.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ minWidth: 0, height: 32, px: 1, gap: 1, color: 'text.secondary' }}
      >
        <ActiveIcon sx={{ fontSize: 16 }} />
        <ChevronDownIcon sx={{ fontSize: 14 }} />
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        {VIEW_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const selected = viewMode === option.value;
          return (
            <MenuItem
              key={option.value}
              data-testid={`view-mode-${option.value}`}
              onClick={() => {
                onViewModeChange(option.value);
                setAnchorEl(null);
              }}
              sx={{ gap: 1.5 }}
            >
              <ListItemText>{option.label}</ListItemText>
              <OptionIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <ListItemIcon sx={{ minWidth: 'auto !important' }}>
                <CheckIcon sx={{ fontSize: 16, color: selected ? 'text.primary' : 'transparent' }} />
              </ListItemIcon>
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
