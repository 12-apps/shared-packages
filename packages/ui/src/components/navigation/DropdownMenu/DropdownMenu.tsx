import ChevronRight from '@mui/icons-material/ChevronRight';
import MoreVert from '@mui/icons-material/MoreVert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { alpha, styled } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';
import React, { cloneElement, isValidElement,useRef, useState } from 'react';

import type { DropdownMenuItem,DropdownMenuProps } from './DropdownMenu.types';

// Resolves every light/dark decision once. The inline version repeated
// `theme.palette.mode === 'dark' ? … : …` nine times, and two of those had the
// SAME expression on both branches (background.paper, and common.white for the
// inset highlight) — so they read as mode-dependent while never varying.
const glassTokens = (theme: Theme) => {
  const isDark = theme.palette.mode === 'dark';

  return {
    edge: isDark ? theme.palette.common.white : theme.palette.common.black,
    dropShadowAlpha: isDark ? 0.4 : 0.12,
    insetHighlightAlpha: isDark ? 0.2 : 0.8,
    sheenAlpha: isDark ? 0.1 : 0.8,
  };
};

const glassMenuStyles = (theme: Theme): CSSObject => {
  const { edge, dropShadowAlpha, insetHighlightAlpha, sheenAlpha } = glassTokens(theme);

  return {
    backgroundColor: alpha(theme.palette.background.paper, 0.75),
    backdropFilter: 'blur(24px) saturate(1.8)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.8)', // Safari support
    border: `1px solid ${alpha(edge, 0.12)}`,
    boxShadow: [
      `0 8px 32px ${alpha(theme.palette.common.black, dropShadowAlpha)}`,
      `0 0 0 1px ${alpha(edge, 0.05)}`,
      `inset 0 1px 0 ${alpha(theme.palette.common.white, insetHighlightAlpha)}`,
    ].join(', '),
    // Enhanced glass morphism with subtle gradient overlay
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: `linear-gradient(135deg, ${alpha(theme.palette.common.white, sheenAlpha)} 0%, transparent 50%)`,
      borderRadius: 'inherit',
      pointerEvents: 'none',
      zIndex: 1,
    },
    // Ensure content appears above the overlay
    '& .MuiList-root': {
      position: 'relative',
      zIndex: 2,
    },
  };
};

const StyledMenu = styled(Menu, {
  shouldForwardProp: (prop) => prop !== 'customVariant' && prop !== 'size',
})<{ customVariant?: string; size?: string }>(({ theme, customVariant, size }) => ({
  '& .MuiPaper-root': {
    minWidth: 180,
    borderRadius: theme.spacing(1),

    ...(customVariant === 'glass' && glassMenuStyles(theme)),

    ...(customVariant === 'minimal' && {
      boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.08)}`,
      border: `1px solid ${theme.palette.divider}`,
    }),

    ...(size === 'sm' && {
      '& .MuiMenuItem-root': {
        fontSize: '0.875rem',
        minHeight: 32,
        padding: theme.spacing(0.75, 2),
      },
    }),

    ...(size === 'lg' && {
      '& .MuiMenuItem-root': {
        fontSize: '1.125rem',
        minHeight: 48,
        padding: theme.spacing(1.5, 3),
      },
    }),
  },
}));

const StyledMenuItem = styled(MenuItem, {
  shouldForwardProp: (prop) => !['color', 'showIconSpace'].includes(prop as string),
})<{ color?: string; showIconSpace?: boolean }>(({ theme, color, showIconSpace }) => ({
  borderRadius: theme.spacing(0.5),
  margin: theme.spacing(0.5, 1),
  transition: 'all 0.2s ease',

  ...(showIconSpace && {
    paddingLeft: theme.spacing(5),
  }),

  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },

  ...(color &&
    color !== 'default' && {
      color:
        theme.palette[color as 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success']
          ?.main || theme.palette.text.primary,
      '& .MuiListItemIcon-root': {
        color:
          theme.palette[color as 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success']
            ?.main || theme.palette.text.primary,
      },
      '&:hover': {
        backgroundColor: alpha(
          theme.palette[color as 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success']
            ?.main || theme.palette.primary.main,
          0.08,
        ),
      },
    }),
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
  item: DropdownMenuItem,
  handleItemClick: (item: DropdownMenuItem) => void,
  showIconSpace?: boolean,
  size?: string,
) => {
  if (item.type === 'divider') {
    return <Divider key={item.id} sx={{ my: 0.5 }} />;
  }

  if (item.type === 'header') {
    return <MenuHeader key={item.id}>{item.label}</MenuHeader>;
  }

  if (item.component) {
    return (
      <Box key={item.id} sx={{ px: 2, py: 1 }}>
        {item.component}
      </Box>
    );
  }

  return renderLeafMenuItem(item, handleItemClick, showIconSpace, size);
};

const renderLeafMenuItem = (
  item: DropdownMenuItem,
  handleItemClick: (item: DropdownMenuItem) => void,
  showIconSpace?: boolean,
  size?: string,
) => {
  const hasIcon = !!item.icon;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <StyledMenuItem
      key={item.id}
      disabled={item.disabled}
      onClick={!item.disabled ? () => handleItemClick(item) : undefined} // ← change
      color={item.color}
      showIconSpace={showIconSpace && !hasIcon}
      data-testid={item.dataTestId}
    >
      {hasIcon && (
        <ListItemIcon sx={{ minWidth: size === 'sm' ? 32 : 40 }}>{item.icon}</ListItemIcon>
      )}
      <ListItemText primary={item.label} />
      {item.shortcut && <ShortcutText variant="caption">{item.shortcut}</ShortcutText>}
      {hasChildren && item.showChevron !== false && (
        <ChevronRight fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
      )}
    </StyledMenuItem>
  );
};

// Open state and anchor are each either caller-supplied or ours. Resolving both
// here keeps those four branches out of the render body.
const resolveMenuState = (
  controlledOpen: boolean | undefined,
  internalOpen: boolean,
  providedAnchorEl: DropdownMenuProps['anchorEl'],
  anchorRef: React.RefObject<HTMLElement | null>,
) => {
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const anchorEl = providedAnchorEl || anchorRef.current;

  return { isControlled, open, anchorEl, isOpen: Boolean(anchorEl) && open };
};

// Open/close state is either ours or the caller's; every handler has to respect
// that, so they are grouped here rather than repeating the isControlled check
// inline four times in the render.
const useDropdownHandlers = ({
  isControlled,
  open,
  setInternalOpen,
  onOpen,
  onClose,
  closeOnItemClick,
  anchorRef,
}: {
  isControlled: boolean;
  open: boolean;
  setInternalOpen: (value: boolean) => void;
  onOpen?: () => void;
  onClose?: () => void;
  closeOnItemClick?: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
}) => {
  const handleOpen = () => {
    if (!isControlled) {
      setInternalOpen(true);
    }
    onOpen?.();
  };

  const handleClose = () => {
    if (!isControlled) {
      setInternalOpen(false);
    }
    onClose?.();
  };

  const handleItemClick = (item: DropdownMenuItem) => {
    item.onClick?.();
    if (closeOnItemClick && !item.children?.length) {
      handleClose();
    }
  };

  const handleTriggerClick = (event: React.MouseEvent<HTMLElement>) => {
    if (isControlled) return;

    if (open) {
      handleClose();
      return;
    }

    (anchorRef as React.MutableRefObject<HTMLElement>).current = event.currentTarget;
    handleOpen();
  };

  return { handleClose, handleItemClick, handleTriggerClick };
};

// The trigger is either a caller-supplied element we clone to attach our click
// handler and ref, arbitrary children we wrap, or the default kebab icon.
const DropdownTrigger: React.FC<{
  trigger: DropdownMenuProps['trigger'];
  anchorRef: React.RefObject<HTMLElement | null>;
  onTriggerClick: (event: React.MouseEvent<HTMLElement>) => void;
}> = ({ trigger, anchorRef, onTriggerClick }) => {
  if (isValidElement(trigger)) {
    return cloneElement(
      trigger as React.ReactElement<{
        onClick?: (event: React.MouseEvent<HTMLElement>) => void;
        ref?: React.Ref<HTMLElement>;
      }>,
      { onClick: onTriggerClick, ref: anchorRef },
    );
  }

  if (trigger) {
    return (
      <Box ref={anchorRef} onClick={onTriggerClick}>
        {trigger}
      </Box>
    );
  }

  return (
    <Box
      ref={anchorRef}
      onClick={onTriggerClick}
      sx={{ cursor: 'pointer', display: 'inline-flex' }}
    >
      <MoreVert />
    </Box>
  );
};

export const DropdownMenu = React.forwardRef<HTMLDivElement, DropdownMenuProps>(
  (
    {
      variant = 'default',
      items,
      trigger,
      open: controlledOpen,
      onOpen,
      onClose,
      size = 'md',
      maxHeight = 400,
      minWidth = 180,
      closeOnItemClick = true,
      showIconSpace = false,
      anchorEl: providedAnchorEl,
      ...menuProps
    },
    ref,
  ) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const anchorRef = useRef<HTMLElement>(null);

    const { isControlled, open, anchorEl, isOpen } = resolveMenuState(
      controlledOpen,
      internalOpen,
      providedAnchorEl,
      anchorRef,
    );

    const { handleClose, handleItemClick, handleTriggerClick } = useDropdownHandlers({
      isControlled,
      open,
      setInternalOpen,
      onOpen,
      onClose,
      closeOnItemClick,
      anchorRef,
    });

    const triggerElement = (
      <DropdownTrigger trigger={trigger} anchorRef={anchorRef} onTriggerClick={handleTriggerClick} />
    );

    return (
      <>
        {trigger !== undefined && triggerElement}
        <StyledMenu
          ref={ref}
          anchorEl={anchorEl}
          open={isOpen}
          onClose={handleClose}
          customVariant={variant}
          size={size}
          PaperProps={{
            sx: {
              maxHeight,
              minWidth,
              overflow: 'auto',
            },
          }}
          transformOrigin={{ horizontal: 'left', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
          {...menuProps}
        >
          {items.map((item) => renderMenuItem(item, handleItemClick, showIconSpace, size))}
        </StyledMenu>
      </>
    );
  },
);

DropdownMenu.displayName = 'DropdownMenu';
