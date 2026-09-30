import Box from '@mui/material/Box/index.js';
import List from '@mui/material/List/index.js';
import ListItemButton from '@mui/material/ListItemButton/index.js';
import { alpha, keyframes, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import React from 'react';

import { slideIn } from './NavigationMenu.styles';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

const megaMenuSlide = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateY(${rem(theme, 20)});
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

// These styled() components stay module-local: their inferred types cannot be
// named across a module boundary here (TS2742). The plain components exported
// below are what the layouts import.
const NavigationContainer = styled(Box, {
  shouldForwardProp: (prop) => !['variant', 'collapsed', 'minimal'].includes(prop as string),
})<{ variant?: string; collapsed?: boolean; minimal?: boolean }>(({ theme, variant, collapsed, minimal }) => ({
  display: 'flex',
  position: 'relative',
  animation: `${slideIn(theme)} 0.4s ease-out`,
  ...(variant === 'horizontal' && {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    ...(!minimal && {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.95)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`,
      backdropFilter: `blur(${rem(theme, 10)})`,
      borderRadius: theme.spacing(2),
      boxShadow: `0 ${rems(theme, 8, 32)} ${shadowInk(theme, 0.08)}`,
    }),
  }),
  ...(variant === 'vertical' && {
    flexDirection: 'column',
    width: rem(theme, collapsed ? 80 : 280),
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    height: '100%',
    ...(!minimal && {
      background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
      backdropFilter: `blur(${rem(theme, 12)})`,
      borderRadius: theme.spacing(2),
      boxShadow: `0 ${rems(theme, 12, 40)} ${shadowInk(theme, 0.1)}`,
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: rem(theme, 200),
        background: `radial-gradient(ellipse at top, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 70%)`,
        pointerEvents: 'none',
      },
    }),
  }),
  ...(variant === 'mega' && {
    flexDirection: 'column',
    width: '100%',
    ...(!minimal && {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.default, 0.95)} 100%)`,
      backdropFilter: `blur(${rem(theme, 15)})`,
      borderRadius: theme.spacing(3),
      overflow: 'hidden',
      boxShadow: `0 ${rems(theme, 20, 60)} ${shadowInk(theme, 0.12)}`,
    }),
  }),
}));

const StyledList = styled(List, {
  shouldForwardProp: (prop) => !['variant', 'size'].includes(prop as string),
})<{ variant?: string; size?: string }>(({ theme, variant }) => ({
  padding: 0,
  width: '100%',
  ...(variant === 'horizontal' && {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
  }),
  ...(variant === 'mega' && {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${rem(theme, 250)}, 1fr))`,
    gap: theme.spacing(2),
    padding: theme.spacing(2),
  }),
}));

const LogoContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2.5),
  marginBottom: theme.spacing(2),
  position: 'relative',
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.dark, 0.04)} 100%)`,
  borderBottom: `${rem(theme, 2)} solid ${alpha(theme.palette.primary.main, 0.2)}`,
  overflow: 'hidden',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: '-50%',
    right: '-50%',
    width: '200%',
    height: '200%',
    background: `radial-gradient(circle, ${alpha(theme.palette.primary.light, 0.1)} 0%, transparent 70%)`,
    animation: `${slideIn(theme)} 1s ease-out`,
  },

  '& > *': {
    position: 'relative',
    zIndex: 1,
  },
}));

const CollapseButton = styled(ListItemButton)(({ theme }) => ({
  borderRadius: theme.spacing(1.5),
  margin: theme.spacing(1),
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.dark, 0.04)} 100%)`,
  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',

  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    transform: 'scale(1.05)',
    boxShadow: `0 ${rems(theme, 6, 20)} ${alpha(theme.palette.primary.main, 0.2)}`,

    '& .MuiListItemIcon-root': {
      transform: 'rotate(180deg)',
      transition: 'transform 0.3s ease',
    },
  },

  '&:active': {
    transform: 'scale(0.98)',
  },
}));

const MegaMenuSection = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  borderRadius: theme.spacing(2),
  background: `linear-gradient(145deg, ${theme.palette.background.paper} 0%, ${alpha(theme.palette.background.default, 0.9)} 100%)`,
  boxShadow: `0 ${rems(theme, 10, 30)} ${shadowInk(theme, 0.08)}`,
  border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
  position: 'relative',
  overflow: 'hidden',
  animation: `${megaMenuSlide(theme)} 0.5s ease-out`,
  animationFillMode: 'both',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: rem(theme, 3),
    background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.light} 50%, ${theme.palette.primary.main} 100%)`,
    backgroundSize: '200% 100%',
    animation: 'shimmer 3s ease-in-out infinite',
  },

  '@keyframes shimmer': {
    '0%': {
      backgroundPosition: '200% 0',
    },
    '100%': {
      backgroundPosition: '-200% 0',
    },
  },

  '&:hover': {
    transform: `translateY(${rem(theme, -4)})`,
    boxShadow: `0 ${rems(theme, 15, 40)} ${shadowInk(theme, 0.12)}`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },

  '&:nth-of-type(1)': { animationDelay: '0.1s' },
  '&:nth-of-type(2)': { animationDelay: '0.2s' },
  '&:nth-of-type(3)': { animationDelay: '0.3s' },
  '&:nth-of-type(4)': { animationDelay: '0.4s' },
}));

export interface NavigationShellProps extends PropsWithChildren {
  variant?: string;
  collapsed?: boolean;
  minimal?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const NavigationShell = React.forwardRef<HTMLDivElement, NavigationShellProps>(
  ({ children, ...props }, ref) => (
    <NavigationContainer ref={ref} {...props}>
      {children}
    </NavigationContainer>
  ),
);

NavigationShell.displayName = 'NavigationShell';

export const LogoBar: React.FC<PropsWithChildren> = ({ children }) => (
  <LogoContainer>{children}</LogoContainer>
);

export const MenuList: React.FC<PropsWithChildren<{ variant?: string; size?: string }>> = ({
  children,
  ...props
}) => <StyledList {...props}>{children}</StyledList>;

export const CollapseToggle: React.FC<PropsWithChildren<{ onClick: () => void }>> = ({
  children,
  onClick,
}) => <CollapseButton onClick={onClick}>{children}</CollapseButton>;

export const MegaSection: React.FC<{ children: ReactNode }> = ({ children }) => (
  <MegaMenuSection>{children}</MegaMenuSection>
);
