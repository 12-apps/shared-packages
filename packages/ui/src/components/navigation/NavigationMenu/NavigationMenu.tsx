import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MenuIcon from '@mui/icons-material/Menu';
import {
  alpha,
  Box,
  Collapse,
  Divider,
  Fade,
  Grow,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Popover,
  Typography,
} from '@mui/material';
import { keyframes,styled } from '@mui/material/styles';
import React, { useState } from 'react';

import { navItemButtonStyles, pulseGlow, slideIn } from './NavigationMenu.styles';
import { renderMenuItem } from './NavigationMenuItem';
import type { NavigationMenuItem,NavigationMenuProps } from './NavigationMenu.types';

// Animation keyframes
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

// The mega-menu layout is a different shape from the list-based variants: a
// grid of titled sections rather than a single column.
// onItemClick and dataTestId are not on NavigationMenuProps; they arrive through
// the rest props and are forwarded to the item renderer, so they are named here.
type MegaMenuLayoutProps = NavigationMenuProps & {
  collapsed: boolean;
  onItemClick?: (item: NavigationMenuItem) => void;
  dataTestId?: string;
};

const MegaMenuLayout = React.forwardRef<HTMLDivElement, MegaMenuLayoutProps>(
  (
    {
      variant,
      collapsed,
      logo,
      items,
      size,
      minimal,
      onItemClick,
      dataTestId,
      className,
      maxWidth,
      style,
      ...props
    },
    ref,
  ) => {
    return (
    <NavigationContainer
      ref={ref}
      variant={variant}
      minimal={minimal}
      className={className}
      style={{ maxWidth, ...style }}
      {...props}
    >
      <Paper
        elevation={minimal ? 0 : 1}
        sx={{
          width: '100%',
          overflow: 'hidden',
          background: minimal ? 'transparent' : undefined,
        }}
      >
        {logo && <LogoContainer>{logo}</LogoContainer>}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 3,
            p: 3,
          }}
        >
          {items.map((section, sectionIndex) => (
            <MegaMenuSection key={section.id}>
              <Typography
                variant="h6"
                sx={{
                  mb: 2.5,
                  color: 'primary.main',
                  fontWeight: 600,
                  position: 'relative',
                  paddingBottom: 1,

                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '40px',
                    height: '3px',
                    background: (theme) =>
                      `linear-gradient(90deg, ${theme.palette.primary.main} 0%, transparent 100%)`,
                    borderRadius: '2px',
                  },
                }}
              >
                {section.label}
              </Typography>
              <List sx={{ p: 0 }}>
                {section.children?.map((item, itemIndex) => (
                  <Box
                    key={item.id}
                    sx={{
                      animation: `${slideIn} 0.4s ease-out`,
                      animationDelay: `${sectionIndex * 0.1 + itemIndex * 0.05}s`,
                      animationFillMode: 'both',
                    }}
                  >
                    {renderMenuItem(item, variant, size, false, minimal, 0)}
                  </Box>
                ))}
              </List>
            </MegaMenuSection>
          ))}
        </Box>
      </Paper>
    </NavigationContainer>
  );
  },
);

MegaMenuLayout.displayName = 'MegaMenuLayout';

export const NavigationMenu = React.forwardRef<HTMLDivElement, NavigationMenuProps>(
  (
    {
      variant = 'vertical',
      items,
      size = 'md',
      minimal = false,
      collapsible = false,
      collapsed: controlledCollapsed,
      onCollapseChange,
      logo,
      endContent,
      maxWidth,
      showDividers = false,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const [internalCollapsed, setInternalCollapsed] = useState(false);

    const isControlled = controlledCollapsed !== undefined;
    const collapsed = isControlled ? controlledCollapsed : internalCollapsed;

    const handleCollapseToggle = () => {
      if (!isControlled) {
        setInternalCollapsed(!collapsed);
      }
      onCollapseChange?.(!collapsed);
    };

    if (variant === 'mega') {
      return (
        <MegaMenuLayout
          ref={ref}
          variant={variant}
          collapsed={collapsed}
          logo={logo}
          items={items}
          size={size}
          minimal={minimal}
          className={className}
          maxWidth={maxWidth}
          style={style}
          {...props}
        />
      );
    }

    return (
      <NavigationContainer
        ref={ref}
        variant={variant}
        minimal={minimal}
        collapsed={collapsed}
        className={className}
        style={style}
        {...props}
      >
        <Paper
          elevation={minimal ? 0 : variant === 'horizontal' ? 1 : 0}
          sx={{
            width: '100%',
            height: variant === 'vertical' ? '100%' : 'auto',
            overflow: 'hidden',
            background: minimal ? 'transparent' : undefined,
          }}
        >
          {logo && variant === 'vertical' && (
            <LogoContainer>
              {collapsed ? (
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <MenuIcon />
                </Box>
              ) : (
                logo
              )}
            </LogoContainer>
          )}

          {collapsible && variant === 'vertical' && (
            <CollapseButton onClick={handleCollapseToggle}>
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}>
                <MenuIcon />
              </ListItemIcon>
              {!collapsed && <ListItemText primary="Collapse" />}
            </CollapseButton>
          )}

          <StyledList variant={variant} size={size}>
            {items.map((item, index) => (
              <React.Fragment key={item.id}>
                <Box
                  sx={{
                    animation: `${slideIn} 0.4s ease-out`,
                    animationDelay: `${index * 0.05}s`,
                    animationFillMode: 'both',
                  }}
                >
                  {renderMenuItem(item, variant, size, collapsed, minimal, 0)}
                </Box>
                {showDividers && index < items.length - 1 && (
                  <Divider
                    sx={{
                      my: 1,
                      opacity: 0.5,
                      background: (theme) =>
                        `linear-gradient(90deg, transparent 0%, ${alpha(theme.palette.divider, 0.5)} 50%, transparent 100%)`,
                    }}
                  />
                )}
              </React.Fragment>
            ))}
          </StyledList>

          {endContent && (
            <Fade in={true} timeout={600}>
              <Box
                sx={{
                  mt: 'auto',
                  p: 2,
                  borderTop: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  background: (theme) =>
                    `linear-gradient(180deg, transparent 0%, ${alpha(theme.palette.background.default, 0.5)} 100%)`,
                }}
              >
                {endContent}
              </Box>
            </Fade>
          )}
        </Paper>
      </NavigationContainer>
    );
  },
);

NavigationMenu.displayName = 'NavigationMenu';
