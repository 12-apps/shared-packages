import Box from '@mui/material/Box/index.js';
import List from '@mui/material/List/index.js';
import ListItemButton from '@mui/material/ListItemButton/index.js';
import { alpha, keyframes, styled } from '@mui/material/styles/index.js';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import React from 'react';

import { slideIn } from './NavigationMenu.styles';

const megaMenuSlide = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
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
  animation: `${slideIn} 0.4s ease-out`,
  ...(variant === 'horizontal' && {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    ...(!minimal && {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.95)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`,
      backdropFilter: 'blur(10px)',
      borderRadius: theme.spacing(2),
      boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
    }),
  }),
  ...(variant === 'vertical' && {
    flexDirection: 'column',
    width: collapsed ? 80 : 280,
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    height: '100%',
    ...(!minimal && {
      background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
      backdropFilter: 'blur(12px)',
      borderRadius: theme.spacing(2),
      boxShadow: `0 12px 40px ${alpha(theme.palette.common.black, 0.1)}`,
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '200px',
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
      backdropFilter: 'blur(15px)',
      borderRadius: theme.spacing(3),
      overflow: 'hidden',
      boxShadow: `0 20px 60px ${alpha(theme.palette.common.black, 0.12)}`,
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
  }),
}));

const LogoContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2.5),
  marginBottom: theme.spacing(2),
  position: 'relative',
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.dark, 0.04)} 100%)`,
  borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.2)}`,
  overflow: 'hidden',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: '-50%',
    right: '-50%',
    width: '200%',
    height: '200%',
    background: `radial-gradient(circle, ${alpha(theme.palette.primary.light, 0.1)} 0%, transparent 70%)`,
    animation: `${slideIn} 1s ease-out`,
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
    boxShadow: `0 6px 20px ${alpha(theme.palette.primary.main, 0.2)}`,

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
  boxShadow: `0 10px 30px ${alpha(theme.palette.common.black, 0.08)}`,
  border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
  position: 'relative',
  overflow: 'hidden',
  animation: `${megaMenuSlide} 0.5s ease-out`,
  animationFillMode: 'both',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '3px',
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
    transform: 'translateY(-4px)',
    boxShadow: `0 15px 40px ${alpha(theme.palette.common.black, 0.12)}`,
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
