import {
  alpha,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';
import { styled } from '@mui/material/styles';
import React, { cloneElement, isValidElement,useState } from 'react';

import type { ContextMenuItem,ContextMenuProps } from './ContextMenu.types';

const StyledMenu = styled(Menu, {
  shouldForwardProp: (prop) => prop !== 'customVariant' && prop !== 'size',
})<{ customVariant?: string; size?: string }>(({ theme, customVariant, size }) => ({
  '& .MuiPaper-root': {
    minWidth: 160,
    borderRadius: theme.spacing(1),

    ...(customVariant === 'glass' && {
      backgroundColor: alpha(theme.palette.background.paper, 0.85),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
      boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
    }),

    ...(customVariant === 'dark' && {
      backgroundColor: alpha(theme.palette.grey[900], 0.95),
      color: theme.palette.common.white,
      '& .MuiMenuItem-root': {
        color: theme.palette.common.white,
      },
      '& .MuiListItemIcon-root': {
        color: theme.palette.common.white,
      },
      '& .MuiDivider-root': {
        borderColor: alpha(theme.palette.common.white, 0.12),
      },
    }),

    ...(size === 'sm' && {
      '& .MuiMenuItem-root': {
        fontSize: '0.875rem',
        minHeight: 32,
        padding: theme.spacing(0.5, 1.5),
      },
    }),

    ...(size === 'lg' && {
      '& .MuiMenuItem-root': {
        fontSize: '1.125rem',
        minHeight: 48,
        padding: theme.spacing(1.5, 2),
      },
    }),
  },
}));

// `color` names a palette key (`success`, `warning`, …) that MUI's Theme type does
// not index, so it is read structurally and falls back to primary.
const paletteColor = (theme: Theme, color: string): string =>
  (theme.palette as unknown as Record<string, { main?: string }>)[color]?.main ||
  theme.palette.primary.main;

const accentStyles = (theme: Theme, color: string): CSSObject => {
  const main = paletteColor(theme, color);

  return {
    color: main,
    '& .MuiListItemIcon-root': { color: main },
    '&:hover': { backgroundColor: alpha(main, 0.08) },
  };
};

const StyledMenuItem = styled(MenuItem, {
  shouldForwardProp: (prop) => !['color', 'dangerous'].includes(prop as string),
})<{ color?: string; dangerous?: boolean }>(({ theme, color, dangerous }) => ({
  borderRadius: theme.spacing(0.5),
  margin: theme.spacing(0.25, 0.5),
  transition: 'all 0.2s ease',

  '&:hover': {
    backgroundColor: alpha(dangerous ? theme.palette.error.main : theme.palette.primary.main, 0.08),
  },

  ...(dangerous && {
    color: theme.palette.error.main,
    '& .MuiListItemIcon-root': {
      color: theme.palette.error.main,
    },
  }),

  ...(color && color !== 'default' && !dangerous ? accentStyles(theme, color) : {}),
}));

const MenuHeader = styled(Typography)(({ theme }) => ({
  padding: theme.spacing(1, 2),
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  color: theme.palette.text.secondary,
  letterSpacing: 0.5,
}));

const ShortcutText = styled(Typography)(({ theme }) => ({
  fontSize: '0.75rem',
  color: theme.palette.text.secondary,
  marginLeft: 'auto',
  paddingLeft: theme.spacing(2),
}));

const renderMenuItem = (
  item: ContextMenuItem,
  handleItemClick: (item: ContextMenuItem) => void,
  size?: string,
) => {
  if (item.type === 'divider') {
    return <Divider key={item.id} sx={{ my: 0.5 }} />;
  }

  if (item.type === 'header') {
    return <MenuHeader key={item.id}>{item.label}</MenuHeader>;
  }

  const hasIcon = !!item.icon;

  return (
    <StyledMenuItem
      key={item.id}
      disabled={item.disabled}
      onClick={() => handleItemClick(item)}
      color={item.color}
      dangerous={item.dangerous}
    >
      {hasIcon && (
        <ListItemIcon sx={{ minWidth: size === 'sm' ? 32 : 40 }}>{item.icon}</ListItemIcon>
      )}
      <ListItemText primary={item.label} />
      {item.shortcut && <ShortcutText variant="caption">{item.shortcut}</ShortcutText>}
    </StyledMenuItem>
  );
};

interface TriggerOptions {
  disabled: boolean;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

// The trigger is whatever the caller passed as children. A single element is
// cloned, so the handler and cursor land on the caller's own node; anything else
// gets wrapped in a div that can carry them.
const buildTrigger = (
  children: React.ReactNode,
  onContextMenu: (event: React.MouseEvent) => void,
  { disabled, triggerClassName, triggerStyle }: TriggerOptions,
) => {
  const cursor = disabled ? 'default' : 'context-menu';

  if (!isValidElement(children)) {
    return (
      <div
        onContextMenu={onContextMenu}
        className={triggerClassName}
        style={{ ...triggerStyle, cursor }}
      >
        {children}
      </div>
    );
  }

  const element = children as React.ReactElement<{
    onContextMenu?: (event: React.MouseEvent) => void;
    className?: string;
    style?: React.CSSProperties;
  }>;

  return cloneElement(element, {
    onContextMenu,
    className: [
      element.props.className,
      triggerClassName,
      !disabled ? 'context-menu-trigger' : '',
    ]
      .filter(Boolean)
      .join(' '),
    style: { ...element.props.style, ...triggerStyle, cursor },
  });
};

export const ContextMenu = React.forwardRef<HTMLDivElement, ContextMenuProps>(
  (
    {
      variant = 'default',
      items,
      children,
      disabled = false,
      onOpen,
      onClose,
      size = 'md',
      triggerClassName,
      triggerStyle,
      ...menuProps
    },
    ref,
  ) => {
    const [contextMenu, setContextMenu] = useState<{
      mouseX: number;
      mouseY: number;
    } | null>(null);

    const handleContextMenu = (event: React.MouseEvent) => {
      if (disabled) return;

      event.preventDefault();
      setContextMenu(
        contextMenu === null
          ? {
              mouseX: event.clientX + 2,
              mouseY: event.clientY - 6,
            }
          : null,
      );
      onOpen?.(event);
    };

    const handleClose = () => {
      setContextMenu(null);
      onClose?.();
    };

    const handleItemClick = (item: ContextMenuItem) => {
      if (item.onClick) {
        item.onClick();
      }
      handleClose();
    };

    const triggerElement = buildTrigger(children, handleContextMenu, {
      disabled,
      triggerClassName,
      triggerStyle,
    });

    return (
      <>
        {triggerElement}
        <StyledMenu
          ref={ref}
          open={contextMenu !== null}
          onClose={handleClose}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
          }
          customVariant={variant}
          size={size}
          {...menuProps}
        >
          {items.map((item) => renderMenuItem(item, handleItemClick, size))}
        </StyledMenu>
      </>
    );
  },
);

ContextMenu.displayName = 'ContextMenu';
