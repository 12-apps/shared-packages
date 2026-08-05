import { useCallback, useRef, useState } from 'react';

import type { MenubarItem, MenubarProps } from './Menubar.types';

/**
 * Which dropdown is open, and the buttons that opened them.
 *
 * The anchors are kept in a ref rather than state because closing needs to
 * return focus to the button that opened the menu, and that lookup must not
 * itself cause a render.
 */
export const useMenubarMenus = (onClick?: MenubarProps['onClick']) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  const handleMenuOpen = useCallback((itemId: string, anchorEl: HTMLElement) => {
    setActiveMenu(itemId);
    menuRefs.current[itemId] = anchorEl;
  }, []);

  const handleMenuClose = useCallback(() => {
    setActiveMenu((previous) => {
      // Return focus to the button that opened the menu.
      if (previous && menuRefs.current[previous]) {
        menuRefs.current[previous].focus();
      }
      return null;
    });
  }, []);

  const handleItemClick = useCallback(
    (item: MenubarItem) => {
      item.action?.();
      onClick?.(item);
      handleMenuClose();
    },
    [onClick, handleMenuClose],
  );

  return { activeMenu, menuRefs, handleMenuOpen, handleMenuClose, handleItemClick };
};
