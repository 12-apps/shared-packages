import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box/index.js';
import Collapse from '@mui/material/Collapse/index.js';
import Fade from '@mui/material/Fade/index.js';
import Grow from '@mui/material/Grow/index.js';
import List from '@mui/material/List/index.js';
import ListItem from '@mui/material/ListItem/index.js';
import ListItemButton from '@mui/material/ListItemButton/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import Popover from '@mui/material/Popover/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import React, {  } from 'react';

import { useMenuItemState } from './NavigationMenuItem.hooks';
import { navItemButtonStyles, pulseGlow } from './NavigationMenu.styles';
import type { NavigationMenuItem } from './NavigationMenu.types';
import { onMedia, shadowInk, uiInk } from '../../../tokens/ink';
import { rem, rems, sxRem } from '../../../tokens/relative';

// A numeric or empty-string zero is treated the way the package's own Badge
// treats a zero count by default (`Badge.helpers.ts`'s `showZero: false`):
// hidden. `badge && …` prints a bare "0" text node for `badge: 0`, because
// `0 && …` evaluates to the falsy `0` itself rather than `false`. A caller
// who wants a visible zero passes the string `'0'`, which is truthy here.
const hasBadge = (badge: NavigationMenuItem['badge']): boolean =>
  badge !== undefined && badge !== null && badge !== '' && badge !== 0;

const StyledListItem = styled(ListItem, {
  shouldForwardProp: (prop) => !['variant', 'active', 'size', 'level'].includes(prop as string) })<{ variant?: string; active?: boolean; size?: string; level?: number }>(
  ({ theme, variant, level = 0 }) => ({
    padding: 0,
    ...(variant === 'horizontal' && {
      width: 'auto' }),
    ...(level > 0 && {
      paddingLeft: theme.spacing(2 * level) }) }),
);

const StyledListItemButton = styled(ListItemButton, {
  shouldForwardProp: (prop) => !['variant', 'active', 'size', 'collapsed', 'minimal'].includes(prop as string) })<{ variant?: string; active?: boolean; size?: string; collapsed?: boolean; minimal?: boolean }>(
  ({ theme, variant, active, size, collapsed, minimal }) => ({
    ...navItemButtonStyles({ theme, variant, active, size, collapsed, minimal }) }),
);

interface MenuItemRendererProps {
  item: NavigationMenuItem;
  variant: string;
  size: string;
  collapsed: boolean;
  minimal: boolean;
  level: number;
  onItemClick?: (item: NavigationMenuItem) => void;
}

// Hover intent and open/anchor state live in NavigationMenuItem.hooks.

// The flyout a horizontal menu opens on hover.
const MenuItemPopover: React.FC<{
  anchorEl: HTMLElement | null;
  item: NavigationMenuItem;
  size?: string;
  minimal?: boolean;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onItemClick?: (item: NavigationMenuItem) => void;
}> = ({ anchorEl, item, size, minimal, onClose, onMouseEnter, onMouseLeave, onItemClick }) => (
  <Popover
    open={Boolean(anchorEl)}
    anchorEl={anchorEl}
    onClose={onClose}
    anchorOrigin={{
      vertical: 'bottom',
      horizontal: 'left' }}
    transformOrigin={{
      vertical: 'top',
      horizontal: 'left' }}
    disableRestoreFocus
    sx={{
      pointerEvents: 'none' }}
    slotProps={{
      paper: {
        onMouseEnter,
        onMouseLeave,
        sx: {
          pointerEvents: 'auto',
          mt: 0.5,
          borderRadius: 2,
          boxShadow: (theme) => `0 ${rems(theme, 12, 40)} ${shadowInk(theme, 0.15)}`,
          border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          background: (theme) =>
            `linear-gradient(145deg, ${theme.palette.background.paper} 0%, ${alpha(theme.palette.background.default, 0.95)} 100%)`,
          backdropFilter: (theme) => `blur(${rem(theme, 10)})`,
          minWidth: sxRem(200) } } }}
  >
    <List sx={{ p: 1 }}>
      {item.children?.map((child) => {
        const childHasChildren = child.children && child.children.length > 0;

        // Only close popover when clicking leaf nodes (items without children)
        if (childHasChildren) {
          return renderMenuItem(child, 'vertical', size, false, minimal, 0, onItemClick);
        }

        // For leaf nodes, wrap with onClick to close the popover
        return (
          <Box
            key={child.id}
            onClick={onClose}
          >
            {renderMenuItem(child, 'vertical', size, false, minimal, 0, onItemClick)}
          </Box>
        );
      })}
    </List>
  </Popover>
);

// Label, badge/chip and the expand chevron, faded out when the rail collapses.
const MenuItemLabel: React.FC<{
  item: NavigationMenuItem;
  collapsed?: boolean;
  minimal?: boolean;
  open: boolean;
  hasChildren?: boolean;
  size?: string;
  variant?: string;
}> = ({ item, collapsed, open, hasChildren, size, variant }) => (
  <Fade in={!collapsed} timeout={400}>
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
      <ListItemText
        primary={item.label}
        secondary={item.description}
        sx={{
          flex: 1,
          minWidth: 0, // Allows text truncation if needed
        }}
        slotProps={{
          primary: {
            variant: size === 'sm' ? 'body2' : size === 'lg' ? 'h6' : 'body1',
            sx: {
              fontWeight: item.active ? 600 : 400,
              transition: 'all 0.3s ease' } },
          secondary: {
            sx: {
              opacity: 0.7,
              transition: 'all 0.3s ease' } } }}
      />
      {hasBadge(item.badge) && (
        <Box
          component="span"
          data-testid={`navigation-menu-badge-${item.id}`}
          sx={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: sxRem(20),
            height: sxRem(20),
            px: 0.75,
            borderRadius: sxRem(10),
            fontSize: sxRem(12),
            fontWeight: 600,
            color: (theme) => onMedia(theme),
            background: (theme) =>
              `linear-gradient(135deg, ${uiInk(theme).attention.from} 0%, ${uiInk(theme).attention.to} 100%)`,
            boxShadow: (theme) => `0 ${rems(theme, 2, 8)} ${alpha(uiInk(theme).attention.glow, 0.4)}`,
            animation: (theme) =>
              typeof item.badge === 'number' && item.badge > 0
                ? `${pulseGlow(theme)} 2s infinite`
                : 'none' }}
        >
          {item.badge}
        </Box>
      )}
      {hasChildren && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0, // Prevents expand icon from shrinking
            transition: 'transform 0.3s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          {variant === 'horizontal' ? <ChevronRight fontSize="small" /> : <ExpandMore />}
        </Box>
      )}
    </Box>
  </Fade>
);

// The row itself: icon, label, badge and the expand chevron.
const MenuItemContent: React.FC<{
  item: NavigationMenuItem;
  variant?: string;
  size?: string;
  active?: boolean;
  collapsed?: boolean;
  minimal?: boolean;
  level: number;
  open: boolean;
  hasChildren?: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}> = ({
  item,
  variant,
  size,
  active: _active,
  collapsed,
  minimal,
  level,
  open,
  hasChildren,
  onClick,
  onMouseEnter,
  onMouseLeave }) => (
<StyledListItem key={item.id} variant={variant} active={item.active} size={size} level={level}>
      <StyledListItemButton
        variant={variant}
        active={item.active}
        size={size}
        collapsed={collapsed}
        minimal={minimal}
        disabled={item.disabled}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...(item.href && !hasChildren
          ? {
              component: 'a' as React.ElementType,
              href: item.href,
              target: item.target }
          : {})}
      >
        {item.icon && (
          <ListItemIcon
            sx={{
              minWidth: collapsed ? 0 : sxRem(40),
              justifyContent: 'center',
              transition: 'all 0.3s ease',
              '& svg': {
                filter: (theme) => (item.active ? `drop-shadow(0 ${rems(theme, 2, 8)} ${shadowInk(theme, 0.15)})` : 'none'),
                transition: 'all 0.3s ease' } }}
          >
            <Grow in={true} timeout={600}>
              <Box>{item.icon}</Box>
            </Grow>
          </ListItemIcon>
        )}
        {!collapsed && (
          <MenuItemLabel
            item={item}
            collapsed={collapsed}
            minimal={minimal}
            open={open}
            hasChildren={hasChildren}
            size={size}
            variant={variant}
          />
        )}
      </StyledListItemButton>
    </StyledListItem>
);

const MenuItemRenderer: React.FC<MenuItemRendererProps> = ({
  item,
  variant,
  size,
  collapsed,
  minimal,
  level,
  onItemClick }) => {
  const {
    open,
    anchorEl,
    hasChildren,
    handleClick,
    handleMouseEnter,
    handleMouseLeave,
    handlePopoverMouseEnter,
    handlePopoverMouseLeave,
    closePopover } = useMenuItemState({ item, variant, onItemClick });

  const itemContent = (
    <MenuItemContent
      item={item}
      variant={variant}
      size={size}
      active={item.active}
      collapsed={collapsed}
      minimal={minimal}
      level={level}
      open={open}
      hasChildren={hasChildren}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    />
  );

  // Horizontal variant with children - use Popover
  if (hasChildren && variant === 'horizontal') {
    return (
      <React.Fragment key={item.id}>
        {itemContent}
        <MenuItemPopover
          anchorEl={anchorEl}
          item={item}
          size={size}
          minimal={minimal}
          onClose={closePopover}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
          onItemClick={onItemClick}
        />
      </React.Fragment>
    );
  }

  // Vertical variant with children - use Collapse
  if (hasChildren && variant !== 'horizontal') {
    return (
      <React.Fragment key={item.id}>
        {itemContent}
        {!collapsed && (
          <Collapse in={open} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {item.children?.map((child) =>
                renderMenuItem(child, variant, size, collapsed, minimal, level + 1, onItemClick),
              )}
            </List>
          </Collapse>
        )}
      </React.Fragment>
    );
  }

  return itemContent;
};

export const renderMenuItem = (
  item: NavigationMenuItem,
  variant: string = 'vertical',
  size: string = 'md',
  collapsed: boolean = false,
  minimal: boolean = false,
  level: number = 0,
  onItemClick?: (item: NavigationMenuItem) => void,
): React.ReactNode => (
    <MenuItemRenderer
      key={item.id}
      item={item}
      variant={variant}
      size={size}
      collapsed={collapsed}
      minimal={minimal}
      level={level}
      onItemClick={onItemClick}
    />
  );
