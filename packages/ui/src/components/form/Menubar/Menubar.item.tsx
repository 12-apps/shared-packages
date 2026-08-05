import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {
  Box,
  Button,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  useTheme,
} from '@mui/material';
import React from 'react';

import { sizeStyles } from './Menubar.styles';
import type { MenubarItem, MenubarProps } from './Menubar.types';

export interface MenubarItemViewProps {
  item: MenubarItem;
  size: NonNullable<MenubarProps['size']>;
  disabled: boolean;
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  onOpen: (itemId: string, anchorEl: HTMLElement) => void;
  onActivate: (item: MenubarItem) => void;
  onClose: () => void;
  onFocus?: React.FocusEventHandler;
  onBlur?: React.FocusEventHandler;
}

/** One row of an open menu: its icon, its label, and its shortcut hint. */
const DropdownItem: React.FC<{ child: MenubarItem; onActivate: (item: MenubarItem) => void }> = ({
  child,
  onActivate,
}) =>
  child.divider ? (
    <Divider />
  ) : (
    <MenuItem onClick={() => onActivate(child)} disabled={child.disabled}>
      {child.icon && <ListItemIcon>{child.icon}</ListItemIcon>}
      <ListItemText>{child.label}</ListItemText>
      {child.shortcut && (
        <Chip
          label={child.shortcut}
          size="small"
          variant="outlined"
          sx={{ ml: 2, height: 20, fontSize: '0.7rem' }}
        />
      )}
    </MenuItem>
  );

/**
 * A top-level menubar entry. An entry with children opens its dropdown; one
 * without acts immediately — a decision the click and keyboard paths both need,
 * so it is made once here rather than in each handler.
 */
export const MenubarItemView: React.FC<MenubarItemViewProps> = ({
  item,
  size,
  disabled,
  isOpen,
  anchorEl,
  onOpen,
  onActivate,
  onClose,
  onFocus,
  onBlur,
}) => {
  const theme = useTheme();
  const hasChildren = Boolean(item.children && item.children.length > 0);

  const activate = (target: HTMLElement) => {
    if (hasChildren) {
      onOpen(item.id, target);
    } else {
      onActivate(item);
    }
  };

  return (
    <Box>
      <Button
        data-testid={`menubar-button-${item.id}`}
        onClick={(e) => activate(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate(e.currentTarget);
          }
        }}
        // Keeping focus on mousedown is what lets handleMenuClose return it here.
        onMouseDown={(e) => e.preventDefault()}
        onFocus={onFocus}
        onBlur={onBlur}
        disabled={item.disabled || disabled}
        startIcon={item.icon}
        endIcon={hasChildren ? <KeyboardArrowDownIcon /> : null}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={hasChildren ? isOpen : undefined}
        sx={{ color: 'inherit', textTransform: 'none', ...sizeStyles(theme, size) }}
      >
        {item.label}
      </Button>

      {hasChildren && (
        <Menu
          anchorEl={anchorEl}
          open={isOpen}
          onClose={onClose}
          autoFocus
          PaperProps={{ sx: { minWidth: 200, mt: 1 } }}
        >
          {item.children?.map((child) => (
            <DropdownItem key={child.id} child={child} onActivate={onActivate} />
          ))}
        </Menu>
      )}
    </Box>
  );
};
