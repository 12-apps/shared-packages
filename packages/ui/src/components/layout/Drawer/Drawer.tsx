import Close from '@mui/icons-material/Close';
import type { Theme } from '@mui/material/styles/index.js';
import Box from '@mui/material/Box/index.js';
import MuiDrawer from '@mui/material/Drawer/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import type { DrawerContentProps,DrawerHeaderProps, DrawerProps } from './Drawer.types';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

type DrawerAnchor = 'left' | 'right' | 'top' | 'bottom';

/**
 * A `width`/`height` prop as CSS. `sx` reads a number of 1 or less as a
 * fraction of the parent, and that stays so; any other number is design px,
 * through the type scale; a string is as given.
 */
const drawerLength = (theme: Theme, value: number | string | undefined): string | undefined => {
  if (typeof value !== 'number') return value;
  return value <= 1 && value !== 0 ? `${value * 100}%` : rem(theme, value);
};

// `variant` doubles as a position preset, but an explicit `anchor` always wins.
const resolveAnchor = (
  anchor: DrawerProps['anchor'],
  variant: DrawerProps['variant'],
): DrawerAnchor => {
  if (anchor) return anchor;

  // Map variant to anchor position
  switch (variant) {
    case 'right':
      return 'right';
    case 'top':
      return 'top';
    case 'bottom':
      return 'bottom';
    case 'glass':
      return 'right';
    case 'left':
    default:
      return 'left';
  }
};

const buildDrawerStyles = (
  theme: Theme,
  anchor: DrawerAnchor,
  variant: DrawerProps['variant'],
  width: DrawerProps['width'],
  height: DrawerProps['height'],
  // Merged LAST into the surface's own rules, so a caller can shape the sliding
  // surface itself (rounded corners on a bottom sheet, a docked panel's offset)
  // without reaching for the MUI paper class from outside. Undefined by default:
  // omit it and the drawer styles exactly as it always has.
  paperSx?: DrawerProps['paperSx'],
) => {
  const widthCss = drawerLength(theme, width);
  const heightCss = drawerLength(theme, height);
  const baseStyles = {
    width: ['left', 'right'].includes(anchor) ? widthCss : '100%',
    height: ['top', 'bottom'].includes(anchor) ? heightCss : '100%',
    flexShrink: 0,
  };

  if (variant === 'glass') {
    return {
      ...baseStyles,
      '& .MuiDrawer-paper': {
        width: widthCss,
        height: '100%',
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: `blur(${rem(theme, 20)})`,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
        boxShadow: `${rems(theme, 0, 8, 32)} ${shadowInk(theme, 0.1)}`,
        ...paperSx,
      },
    };
  }

  return {
    ...baseStyles,
    '& .MuiDrawer-paper': {
      width: ['left', 'right'].includes(anchor) ? widthCss : '100%',
      height: ['top', 'bottom'].includes(anchor) ? heightCss : '100%',
      boxSizing: 'border-box',
      ...paperSx,
    },
  };
};

export const Drawer: React.FC<DrawerProps> = ({
  children,
  open,
  onClose,
  variant = 'left',
  anchor,
  width,
  height = '100%',
  persistent = false,
  backdrop = true,
  hideBackdrop = false,
  keepMounted = false,
  paperSx,
  className,
  dataTestId,
  ...rest
}) => {
  const theme = useTheme();
  const drawerAnchor = resolveAnchor(anchor, variant);

  return (
    <MuiDrawer
      anchor={drawerAnchor}
      open={open}
      onClose={onClose}
      variant={persistent ? 'persistent' : 'temporary'}
      ModalProps={{
        keepMounted,
        hideBackdrop,
        BackdropProps: {
          invisible: !backdrop,
        },
      }}
      sx={buildDrawerStyles(theme, drawerAnchor, variant, width ?? 280, height, paperSx)}
      className={className}
      data-testid={dataTestId || 'drawer'}
      {...rest}
    >
      {children}
    </MuiDrawer>
  );
};

export const DrawerHeader: React.FC<DrawerHeaderProps> = ({
  children,
  onClose,
  showCloseButton = true,
  closeLabel,
  dataTestId,
}) => {
  const theme = useTheme();

  return (
    <Box
      data-testid={dataTestId || 'drawer-header'}
      sx={{
        display: 'flex',
        alignItems: 'center',
        padding: theme.spacing(2),
        borderBottom: `1px solid ${theme.palette.divider}`,
        minHeight: rem(theme, 64),
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ flex: 1 }} data-testid={dataTestId ? `${dataTestId}-title` : 'drawer-title'}>
        {typeof children === 'string' ? <Typography variant="h6">{children}</Typography> : children}
      </Box>
      {showCloseButton && onClose && (
        <IconButton
          onClick={onClose}
          edge="end"
          aria-label={closeLabel ?? 'Close drawer'}
          data-testid={dataTestId ? `${dataTestId}-close` : 'drawer-close'}
        >
          <Close />
        </IconButton>
      )}
    </Box>
  );
};

export const DrawerContent: React.FC<DrawerContentProps> = ({ children, padding = true, dataTestId }) => {
  const theme = useTheme();

  return (
    <Box
      data-testid={dataTestId || 'drawer-content'}
      sx={{
        flex: 1,
        overflow: 'auto',
        padding: padding ? theme.spacing(2) : 0,
      }}
    >
      {children}
    </Box>
  );
};
