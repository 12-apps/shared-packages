import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import {
  Badge,
  Box,
  Chip,
  Collapse,
  Divider,
  Fade,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  Grow,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, keyframes, styled } from '@mui/material/styles';
import React, { useState } from 'react';

import { navItemButtonStyles, pulseGlow } from './NavigationMenu.styles';
import type { NavigationMenuItem } from './NavigationMenu.types';

const StyledListItem = styled(ListItem, {
  shouldForwardProp: (prop) => !['variant', 'active', 'size', 'level'].includes(prop as string),
})<{ variant?: string; active?: boolean; size?: string; level?: number }>(
  ({ theme, variant, level = 0 }) => ({
    padding: 0,
    ...(variant === 'horizontal' && {
      width: 'auto',
    }),
    ...(level > 0 && {
      paddingLeft: theme.spacing(2 * level),
    }),
  }),
);

const StyledListItemButton = styled(ListItemButton, {
  shouldForwardProp: (prop) => !['variant', 'active', 'size', 'collapsed', 'minimal'].includes(prop as string),
})<{ variant?: string; active?: boolean; size?: string; collapsed?: boolean; minimal?: boolean }>(
  ({ theme, variant, active, size, collapsed, minimal }) => ({
    ...navItemButtonStyles({ theme, variant, active, size, collapsed, minimal }),
  }),
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

// Hover-opened submenus need a grace period on leave, so the pointer can travel
// from the trigger into the popover without it closing underneath.
const CLOSE_DELAY_MS = 150;

const useHoverIntent = ({
  enabled,
  closeTimerRef,
  setAnchorEl,
}: {
  enabled: boolean;
  closeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
}) => {
  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
    if (!enabled) return;

    {
      clearCloseTimer();
      setAnchorEl(event.currentTarget);
    }
  };

  const handleMouseLeave = () => {
    if (!enabled) return;

    {
      // Delay closing to allow user to move to popover
      closeTimerRef.current = setTimeout(() => {
        setAnchorEl(null);
      }, CLOSE_DELAY_MS);
    }
  };

  const handlePopoverMouseEnter = () => {
    clearCloseTimer();
  };

  const handlePopoverMouseLeave = () => {
    setAnchorEl(null);
  };

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, []);

  return {
    clearCloseTimer,
    handleMouseEnter,
    handleMouseLeave,
    handlePopoverMouseEnter,
    handlePopoverMouseLeave,
  };
};

// Submenu open state plus the click and hover handlers. Horizontal menus open
// their children on hover with a close delay, so the pointer can travel into the
// popover; vertical ones toggle on click.
const useMenuItemState = ({
  item,
  variant,
  onItemClick,
}: {
  item: NavigationMenuItem;
  variant?: string;
  onItemClick?: (item: NavigationMenuItem) => void;
}) => {
const [open, setOpen] = useState(false);
const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
const hasChildren = item.children && item.children.length > 0;

const handleClick = (event: React.MouseEvent<HTMLElement>) => {
  if (hasChildren && variant !== 'horizontal') {
    setOpen(!open);
  }
  if (item.onClick) {
    item.onClick(event);
  }
  if (onItemClick) {
    onItemClick(item);
  }
};

  const {
    clearCloseTimer,
    handleMouseEnter,
    handleMouseLeave,
    handlePopoverMouseEnter,
    handlePopoverMouseLeave,
  } = useHoverIntent({
    enabled: Boolean(hasChildren) && variant === 'horizontal',
    closeTimerRef,
    setAnchorEl,
  });

  const closePopover = () => {
    clearCloseTimer();
    setAnchorEl(null);
  };

  return {
    open,
    anchorEl,
    hasChildren,
    handleClick,
    handleMouseEnter,
    handleMouseLeave,
    handlePopoverMouseEnter,
    handlePopoverMouseLeave,
    closePopover,
  };
};

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
      horizontal: 'left',
    }}
    transformOrigin={{
      vertical: 'top',
      horizontal: 'left',
    }}
    disableRestoreFocus
    sx={{
      pointerEvents: 'none',
    }}
    slotProps={{
      paper: {
        onMouseEnter,
        onMouseLeave,
        sx: {
          pointerEvents: 'auto',
          mt: 0.5,
          borderRadius: 2,
          boxShadow: (theme) => `0 12px 40px ${alpha(theme.palette.common.black, 0.15)}`,
          border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          background: (theme) =>
            `linear-gradient(145deg, ${theme.palette.background.paper} 0%, ${alpha(theme.palette.background.default, 0.95)} 100%)`,
          backdropFilter: 'blur(10px)',
          minWidth: 200,
        },
      },
    }}
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
}> = ({ item, collapsed, minimal, open, hasChildren, size, variant }) => (
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
              transition: 'all 0.3s ease',
            },
          },
          secondary: {
            sx: {
              opacity: 0.7,
              transition: 'all 0.3s ease',
            },
          },
        }}
      />
      {item.badge && (
        <Box
          component="span"
          sx={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 20,
            height: 20,
            px: 0.75,
            borderRadius: '10px',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#fff',
            background: 'linear-gradient(135deg, #ff5252 0%, #ff1744 100%)',
            boxShadow: '0 2px 8px rgba(255, 23, 68, 0.4)',
            animation:
              typeof item.badge === 'number' && item.badge > 0
                ? `${pulseGlow} 2s infinite`
                : 'none',
          }}
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
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
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
  active,
  collapsed,
  minimal,
  level,
  open,
  hasChildren,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => (
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
              target: item.target,
            }
          : {})}
      >
        {item.icon && (
          <ListItemIcon
            sx={{
              minWidth: collapsed ? 0 : 40,
              justifyContent: 'center',
              transition: 'all 0.3s ease',
              '& svg': {
                filter: item.active ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))' : 'none',
                transition: 'all 0.3s ease',
              },
            }}
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
  onItemClick,
}) => {
  const {
    open,
    anchorEl,
    hasChildren,
    handleClick,
    handleMouseEnter,
    handleMouseLeave,
    handlePopoverMouseEnter,
    handlePopoverMouseLeave,
    closePopover,
  } = useMenuItemState({ item, variant, onItemClick });

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
