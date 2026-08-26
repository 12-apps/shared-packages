import type { CSSObject } from '@mui/material/styles/index.js';
import type { HTMLAttributes,ReactNode } from 'react';

export type DrawerVariant = 'left' | 'right' | 'top' | 'bottom' | 'glass';
export type DrawerAnchor = 'left' | 'right' | 'top' | 'bottom';

export interface DrawerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  variant?: DrawerVariant;
  anchor?: DrawerAnchor;
  width?: number | string;
  height?: number | string;
  persistent?: boolean;
  temporary?: boolean;
  backdrop?: boolean;
  hideBackdrop?: boolean;
  keepMounted?: boolean;
  /**
   * Extra styles for the sliding surface itself (MUI's drawer paper), merged
   * after the width/height the drawer derives from its anchor.
   *
   * Opt-in and additive: omit it and the drawer renders exactly as it always
   * has. It exists because a temporary drawer PORTALS its surface, so a
   * consumer cannot reach it with a wrapper's descendant selector — a bottom
   * sheet that wants rounded top corners has no other way to ask.
   */
  paperSx?: CSSObject;
  className?: string;
  dataTestId?: string;
}

export interface DrawerHeaderProps {
  children: ReactNode;
  onClose?: () => void;
  showCloseButton?: boolean;
  /**
   * Accessible name for the close button. Defaults to "Close drawer".
   *
   * A drawer that is not a drawer to its user needs to say what it closes:
   * the report builder's block panel is a docked side panel, and "Fechar
   * painel" is what its spec asks to hear (FUT-755). Left unset the wording is
   * unchanged, so existing consumers asserting on the default keep passing.
   */
  closeLabel?: string;
  dataTestId?: string;
}

export interface DrawerContentProps {
  children: ReactNode;
  padding?: boolean;
  dataTestId?: string;
}
