import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {
  AppBar,
  Box,
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useState } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { useMenubarMenus } from './Menubar.hooks';
import { barStyles } from './Menubar.styles';
import { MenubarToolbar } from './Menubar.toolbar';

import type {
  MenubarGroupProps,
  MenubarItem,
  MenubarProps,
} from './Menubar.types';

const DEFAULTS = {
  variant: 'default',
  size: 'md',
  color: 'neutral',
  orientation: 'horizontal',
  glow: false,
  pulse: false,
  glass: false,
  gradient: false,
  loading: false,
  disabled: false,
  sticky: false,
  transparent: false,
  blur: false,
  elevation: 4,
  fullWidth: true,
} satisfies Partial<MenubarProps>;

type ResolvedProps = MenubarProps & Required<Pick<MenubarProps, keyof typeof DEFAULTS>>;

export const Menubar: React.FC<MenubarProps> = (props) => {
  const {
    items, variant, size, color, orientation, glow, pulse, glass, gradient,
    loading, disabled, className, style, logo, endContent, sticky, transparent,
    blur, elevation, fullWidth, onClick, onFocus, onBlur,
    'data-testid': dataTestId,
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const theme = useTheme();
  const { activeMenu, menuRefs, handleMenuOpen, handleMenuClose, handleItemClick } =
    useMenubarMenus(onClick);

  const isVertical = orientation === 'vertical';

  const barSx = barStyles(theme, {
    variant, size, color, glow, pulse, glass, gradient, blur, transparent, elevation,
  });

  const content = (
    <MenubarToolbar
      barSx={barSx}
      items={items}
      size={size}
      orientation={orientation}
      disabled={disabled}
      loading={loading}
      logo={logo}
      endContent={endContent}
      fullWidth={fullWidth}
      activeMenu={activeMenu}
      menuRefs={menuRefs}
      onOpen={handleMenuOpen}
      onActivate={handleItemClick}
      onClose={handleMenuClose}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );

  // A vertical bar is not an app bar: AppBar's fixed/sticky positioning assumes
  // a horizontal strip at the top of the page.
  if (isVertical) {
    return (
      <Box
        className={className}
        sx={{
          ...style,
          position: sticky ? 'sticky' : 'relative',
          top: sticky ? 0 : 'auto',
          zIndex: theme.zIndex.appBar,
        }}
      >
        {content}
      </Box>
    );
  }

  return (
    <AppBar
      position={sticky ? 'sticky' : 'static'}
      className={className}
      data-testid={dataTestId}
      sx={{ ...barSx, ...style }}
      elevation={0}
      component="header"
    >
      {content}
    </AppBar>
  );
};


export const MenubarGroup: React.FC<MenubarGroupProps> = ({
  label,
  items,
  icon,
  disabled,
  open,
  onOpenChange,
  onClick,
  className,
  style,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const isOpen = open !== undefined ? open : Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    onOpenChange?.(true);
  };

  const handleClose = () => {
    setAnchorEl(null);
    onOpenChange?.(false);
  };

  const handleItemClick = (item: MenubarItem) => {
    if (item.action) {
      item.action();
    }
    onClick?.(item);
    handleClose();
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={disabled}
        startIcon={icon}
        endIcon={<KeyboardArrowDownIcon />}
        className={className}
        sx={style}
      >
        {label}
      </Button>
      <Menu anchorEl={anchorEl} open={isOpen} onClose={handleClose}>
        {items.map((item) =>
          item.divider ? (
            <Divider key={item.id} />
          ) : (
            <MenuItem key={item.id} onClick={() => handleItemClick(item)} disabled={item.disabled}>
              {item.icon && <ListItemIcon>{item.icon}</ListItemIcon>}
              <ListItemText>{item.label}</ListItemText>
              {item.shortcut && (
                <Typography variant="caption" sx={{ ml: 2 }}>
                  {item.shortcut}
                </Typography>
              )}
            </MenuItem>
          ),
        )}
      </Menu>
    </>
  );
};

export { MenubarSeparator } from './Menubar.separator';
