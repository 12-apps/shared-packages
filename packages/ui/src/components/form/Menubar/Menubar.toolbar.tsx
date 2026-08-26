import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Toolbar from '@mui/material/Toolbar/index.js';
import type { CSSObject } from '@mui/material/styles/index.js';
import React from 'react';

import { MenubarItemView } from './Menubar.item';
import { MenubarSeparator } from './Menubar.separator';
import type { MenubarItem, MenubarProps } from './Menubar.types';

export interface MenubarToolbarProps {
  ariaLabel: string;
  barSx: CSSObject;
  items: MenubarItem[];
  size: NonNullable<MenubarProps['size']>;
  orientation: NonNullable<MenubarProps['orientation']>;
  disabled: boolean;
  loading: boolean;
  logo?: React.ReactNode;
  endContent?: React.ReactNode;
  fullWidth: boolean;
  activeMenu: string | null;
  menuRefs: React.MutableRefObject<{ [key: string]: HTMLElement | null }>;
  onOpen: (itemId: string, anchorEl: HTMLElement) => void;
  onActivate: (item: MenubarItem) => void;
  onClose: () => void;
  onFocus?: React.FocusEventHandler;
  onBlur?: React.FocusEventHandler;
}

/**
 * The bar's contents: an optional logo, the entries themselves, and whatever the
 * caller hangs off the end. Shared by both orientations — only the element
 * wrapping it differs.
 */
export const MenubarToolbar: React.FC<MenubarToolbarProps> = ({
  ariaLabel,
  barSx,
  items,
  size,
  orientation,
  disabled,
  loading,
  logo,
  endContent,
  fullWidth,
  activeMenu,
  menuRefs,
  onOpen,
  onActivate,
  onClose,
  onFocus,
  onBlur,
}) => {
  const isVertical = orientation === 'vertical';

  return (
    <Toolbar
      role="toolbar"
      aria-label={ariaLabel}
      sx={{
        ...barSx,
        width: fullWidth ? '100%' : 'auto',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: isVertical ? 'flex-start' : 'center',
        gap: 1,
      }}
    >
      {logo && <Box sx={{ mr: 2, display: 'flex', alignItems: 'center' }}>{logo}</Box>}

      {loading ? (
        <CircularProgress size={20} color="inherit" />
      ) : (
        <Box
          sx={{
            display: 'flex',
            flexDirection: isVertical ? 'column' : 'row',
            gap: isVertical ? 0.5 : 1,
            flex: 1,
          }}
        >
          {items.map((item) =>
            item.divider ? (
              <MenubarSeparator key={item.id} orientation={orientation} />
            ) : (
              <MenubarItemView
                key={item.id}
                item={item}
                size={size}
                disabled={disabled}
                isOpen={activeMenu === item.id}
                anchorEl={menuRefs.current[item.id] ?? null}
                onOpen={onOpen}
                onActivate={onActivate}
                onClose={onClose}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            ),
          )}
        </Box>
      )}

      {endContent && <Box sx={{ ml: 'auto' }}>{endContent}</Box>}
    </Toolbar>
  );
};
