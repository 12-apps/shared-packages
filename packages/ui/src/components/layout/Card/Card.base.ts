import type * as React from 'react';

/**
 * THE CONTRACT BOTH `Card` RENDERERS HONOUR — and nothing else.
 *
 * This file imports no MUI and no react-native, on purpose: it ships in BOTH
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against.
 *
 * Handlers are NOT here. Their names are the same on both sides (`onClick`,
 * `onFocus`, `onBlur`) but their event types are the renderer's own, so each
 * side declares them beside its own extras — except {@link
 * CardBaseProps.onExpandToggle}, whose argument is a boolean rather than an
 * event and is therefore the same type on both.
 */
export type CardVariant = 'elevated' | 'outlined' | 'glass' | 'gradient' | 'neumorphic' | 'section';
export type CardEntranceAnimation =
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'zoom'
  | 'grow'
  | 'none';

/** The named radii a card can be cut to. `full` is a percentage, not a length. */
export type CardBorderRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface CardBaseProps {
  children: React.ReactNode;
  variant?: CardVariant;
  /** Paints the hover/press surface and marks the card as a pointer target. */
  interactive?: boolean;
  glow?: boolean;
  pulse?: boolean;
  borderRadius?: CardBorderRadius;
  /** Dims the card, blocks pointer events and centres a spinner over it. */
  loading?: boolean;
  /**
   * Accepted and ignored on BOTH renderers — reserved, and extracted so they
   * never reach the underlying element as unknown attributes.
   */
  expandable?: boolean;
  expanded?: boolean;
  onExpandToggle?: (expanded: boolean) => void;
  entranceAnimation?: CardEntranceAnimation;
  animationDelay?: number;
  skeleton?: boolean;
  hoverScale?: number;
  dataTestId?: string;
  testID?: string;
}

export interface CardHeaderBaseProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  avatar?: React.ReactNode;
  /** Custom header content; when given it replaces the title/subtitle layout. */
  children?: React.ReactNode;
  dataTestId?: string;
  testID?: string;
}

export interface CardContentBaseProps {
  children: React.ReactNode;
  dense?: boolean;
  dataTestId?: string;
  testID?: string;
}

export type CardActionsAlignment = 'left' | 'center' | 'right' | 'space-between';

export interface CardActionsBaseProps {
  children: React.ReactNode;
  disableSpacing?: boolean;
  alignment?: CardActionsAlignment;
  dataTestId?: string;
  testID?: string;
}

export interface CardMediaBaseProps {
  /** The image URL. */
  image?: string;
  /** The media's accessible name. */
  title?: string;
  height?: number | string;
  children?: React.ReactNode;
  dataTestId?: string;
  testID?: string;
}
