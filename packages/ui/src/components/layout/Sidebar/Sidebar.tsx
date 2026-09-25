import Box from '@mui/material/Box/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React from 'react';

import type {
  SidebarContentProps,
  SidebarFooterProps,
  SidebarHeaderProps,
  SidebarProps,
} from './Sidebar.types';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

/**
 * A width prop as CSS. `sx` reads a number of 1 or less as a fraction of the
 * parent, and that stays so; any other number is design px, through the type scale.
 */
const widthCss = (theme: Theme, value: number): string =>
  value <= 1 && value !== 0 ? `${value * 100}%` : rem(theme, value);

export const Sidebar: React.FC<SidebarProps> = ({
  children,
  variant = 'fixed',
  open = true,
  onToggle: _onToggle,
  width,
  collapsedWidth,
  position = 'left',
  className,
  dataTestId = 'sidebar',
  ...rest
}) => {
  // Prevent unused variable warning for onToggle
  void _onToggle;
  const theme = useTheme();

  const isCollapsed = variant === 'collapsible' && !open;
  // Design px: 280 open, 64 collapsed, unless the caller says otherwise.
  const currentWidth = isCollapsed ? (collapsedWidth ?? 64) : (width ?? 280);

  const getVariantStyles = () => {
    switch (variant) {
      case 'floating':
        return {
          position: 'fixed' as const,
          top: theme.spacing(2),
          bottom: theme.spacing(2),
          [position]: theme.spacing(2),
          borderRadius: theme.spacing(2),
          boxShadow: theme.shadows[8],
          zIndex: theme.zIndex.drawer,
        };
      case 'glass':
        return {
          backgroundColor: alpha(theme.palette.background.paper, 0.1),
          backdropFilter: `blur(${rem(theme, 20)})`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          boxShadow: `${rems(theme, 0, 8, 32)} ${shadowInk(theme, 0.1)}`,
        };
      case 'collapsible':
        return {
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        };
      default:
        return {
          backgroundColor: theme.palette.background.paper,
          borderRight: `1px solid ${theme.palette.divider}`,
        };
    }
  };

  return (
    <Box
      className={className}
      data-testid={dataTestId}
      {...rest}
      sx={{
        width: widthCss(theme, currentWidth),
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...getVariantStyles(),
      }}
    >
      {children}
    </Box>
  );
};

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({ children, dataTestId = 'sidebar-header', ...rest }) => {
  const theme = useTheme();

  return (
    <Box
      data-testid={dataTestId}
      {...rest}
      sx={{
        padding: theme.spacing(2),
        borderBottom: `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {children}
    </Box>
  );
};

export const SidebarContent: React.FC<SidebarContentProps> = ({ children, dataTestId = 'sidebar-content', ...rest }) => (
    <Box
      data-testid={dataTestId}
      {...rest}
      sx={{
        flex: 1,
        overflow: 'auto',
      }}
    >
      {children}
    </Box>
  );

export const SidebarFooter: React.FC<SidebarFooterProps> = ({ children, dataTestId = 'sidebar-footer', ...rest }) => {
  const theme = useTheme();

  return (
    <Box
      data-testid={dataTestId}
      {...rest}
      sx={{
        padding: theme.spacing(2),
        borderTop: `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
      }}
    >
      {children}
    </Box>
  );
};
