import type { ReactNode } from 'react';

import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH `Dialog` RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here, on purpose: this file ships in BOTH
 * declaration outputs, and a native consumer has no `@mui/material` to resolve
 * a type import against.
 *
 * `onClose` IS here, unusually for a handler, because it takes no event on
 * either side: MUI's own `onClose` reason argument is dropped by `Dialog.tsx`
 * before it reaches the caller, so both renderers pass a bare `() => void`.
 */
export type DialogVariant = 'default' | 'glass' | 'fullscreen' | 'drawer';
export type DialogSize = SizeValue;
export type DialogBorderRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type DialogActionsAlignment = 'left' | 'center' | 'right' | 'space-between';

export interface DialogBaseProps {
  open: boolean;
  children: ReactNode;
  variant?: DialogVariant;
  size?: DialogSize;
  title?: ReactNode;
  description?: string;
  showCloseButton?: boolean;
  /** Ignored by BOTH renderers today; see `Dialog.metrics.ts`. */
  backdrop?: boolean;
  /** Refuses to close on a backdrop press or Escape. */
  persistent?: boolean;
  glass?: boolean;
  gradient?: boolean;
  glow?: boolean;
  pulse?: boolean;
  borderRadius?: DialogBorderRadius;
  onClose?: () => void;
  dataTestId?: string;
  testID?: string;
}

export interface DialogHeaderBaseProps {
  /** Custom header content; when given it replaces the title/subtitle layout. */
  children?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  showCloseButton?: boolean;
  onClose?: () => void;
  dataTestId?: string;
  testID?: string;
}

export interface DialogContentBaseProps {
  children: ReactNode;
  dividers?: boolean;
  dense?: boolean;
  dataTestId?: string;
  testID?: string;
}

export interface DialogActionsBaseProps {
  children: ReactNode;
  alignment?: DialogActionsAlignment;
  /** Between the actions, in spacing units. */
  spacing?: number;
  dataTestId?: string;
  testID?: string;
}
