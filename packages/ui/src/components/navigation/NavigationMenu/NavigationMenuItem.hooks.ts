import React, { useState } from 'react';

import type { NavigationMenuItem } from './NavigationMenu.types';

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
export const useMenuItemState = ({
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
