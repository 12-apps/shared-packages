import MenuIcon from '@mui/icons-material/Menu';
import { alpha, Box, Divider, Fade, ListItemIcon, ListItemText, Paper } from '@mui/material';
import type { FC, ReactNode } from 'react';
import React from 'react';

import { CollapseToggle, LogoBar, MenuList } from './NavigationMenu.shell';
import { slideIn } from './NavigationMenu.styles';
import type { NavigationMenuItem } from './NavigationMenu.types';
import { renderMenuItem } from './NavigationMenuItem';

const DividerRule: FC = () => (
  <Divider
    sx={{
      my: 1,
      opacity: 0.5,
      background: (theme) =>
        `linear-gradient(90deg, transparent 0%, ${alpha(theme.palette.divider, 0.5)} 50%, transparent 100%)`,
    }}
  />
);

const VerticalLogo: FC<{ logo: ReactNode; collapsed: boolean }> = ({ logo, collapsed }) => (
  <LogoBar>
    {collapsed ? (
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <MenuIcon />
      </Box>
    ) : (
      logo
    )}
  </LogoBar>
);

const CollapseControl: FC<{ collapsed: boolean; onToggle: () => void }> = ({
  collapsed,
  onToggle,
}) => (
  <CollapseToggle onClick={onToggle}>
    <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}>
      <MenuIcon />
    </ListItemIcon>
    {!collapsed && <ListItemText primary="Collapse" />}
  </CollapseToggle>
);

const MenuItems: FC<{
  items: NavigationMenuItem[];
  variant: string;
  size: string;
  collapsed: boolean;
  minimal: boolean;
  showDividers: boolean;
}> = ({ items, variant, size, collapsed, minimal, showDividers }) => (
  <MenuList variant={variant} size={size}>
    {items.map((item, index) => (
      <React.Fragment key={item.id}>
        <Box
          sx={{
            // Staggered so the list fills in rather than appearing at once.
            animation: `${slideIn} 0.4s ease-out`,
            animationDelay: `${index * 0.05}s`,
            animationFillMode: 'both',
          }}
        >
          {renderMenuItem(item, variant, size, collapsed, minimal, 0)}
        </Box>
        {showDividers && index < items.length - 1 && <DividerRule />}
      </React.Fragment>
    ))}
  </MenuList>
);

const EndPanel: FC<{ children: ReactNode }> = ({ children }) => (
  <Fade in timeout={600}>
    <Box
      sx={{
        mt: 'auto',
        p: 2,
        borderTop: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        background: (theme) =>
          `linear-gradient(180deg, transparent 0%, ${alpha(theme.palette.background.default, 0.5)} 100%)`,
      }}
    >
      {children}
    </Box>
  </Fade>
);

export interface NavigationStandardBodyProps {
  variant: string;
  size: string;
  minimal: boolean;
  collapsed: boolean;
  collapsible: boolean;
  showDividers: boolean;
  items: NavigationMenuItem[];
  logo?: ReactNode;
  endContent?: ReactNode;
  onCollapseToggle: () => void;
}

// The list-based layouts (vertical and horizontal). The logo and the collapse
// control only apply to the vertical one.
export const NavigationStandardBody: FC<NavigationStandardBodyProps> = ({
  variant,
  size,
  minimal,
  collapsed,
  collapsible,
  showDividers,
  items,
  logo,
  endContent,
  onCollapseToggle,
}) => {
  const isVertical = variant === 'vertical';
  // Only the horizontal bar is raised; vertical rails and minimal sit flat.
  const elevation = !minimal && variant === 'horizontal' ? 1 : 0;

  return (
    <Paper
      elevation={elevation}
      sx={{
        width: '100%',
        height: isVertical ? '100%' : 'auto',
        overflow: 'hidden',
        background: minimal ? 'transparent' : undefined,
      }}
    >
      {logo && isVertical && <VerticalLogo logo={logo} collapsed={collapsed} />}

      {collapsible && isVertical && (
        <CollapseControl collapsed={collapsed} onToggle={onCollapseToggle} />
      )}

      <MenuItems
        items={items}
        variant={variant}
        size={size}
        collapsed={collapsed}
        minimal={minimal}
        showDividers={showDividers}
      />

      {endContent && <EndPanel>{endContent}</EndPanel>}
    </Paper>
  );
};
