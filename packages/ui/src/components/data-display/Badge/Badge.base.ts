import type React from 'react';

import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * This file imports no MUI and no react-native, on purpose: it is in BOTH
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against.
 */
export type BadgeVariant =
  | 'default'
  | 'dot'
  | 'count'
  | 'gradient'
  | 'glass'
  | 'outline'
  | 'secondary'
  | 'destructive'
  | 'success'
  | 'warning';

export type BadgeSize = SizeValue;

export type BadgePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface BadgeBaseProps {
  /**
   * The variant of the badge
   */
  variant?: BadgeVariant;

  /**
   * The size of the badge
   */
  size?: BadgeSize;

  /**
   * The color of the badge
   */
  color?: ColorValue;

  /**
   * Whether the badge should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the badge should have a pulse animation
   */
  pulse?: boolean;

  /**
   * Whether to animate the badge on mount
   */
  animate?: boolean;

  /**
   * Maximum count to display (shows "max+" when exceeded)
   */
  max?: number;

  /**
   * Whether to show zero count
   */
  showZero?: boolean;

  /**
   * Custom content for the badge
   */
  content?: React.ReactNode;

  /** MUI's own name for {@link BadgeBaseProps.content}; `content` wins. */
  badgeContent?: React.ReactNode;

  /**
   * Position of the badge
   */
  position?: BadgePosition;

  /** Hides the badge while keeping what it is attached to. */
  invisible?: boolean;

  /**
   * Accessibility label for screen readers
   */
  'aria-label'?: string;

  /**
   * ARIA live region behavior
   */
  'aria-live'?: 'off' | 'polite' | 'assertive';

  /**
   * Whether the live region should be atomic
   */
  'aria-atomic'?: boolean;

  /**
   * Whether the badge should be closable
   */
  closable?: boolean;

  /**
   * Callback when badge is closed
   */
  onClose?: () => void;

  /**
   * Whether to show a shimmer effect
   */
  shimmer?: boolean;

  /**
   * Whether to bounce on mount
   */
  bounce?: boolean;

  /**
   * Custom icon element to display in the badge
   */
  icon?: React.ReactNode;

  /** What the badge is attached to. */
  children?: React.ReactNode;

  /**
   * Custom test ID for testing
   */
  'data-testid'?: string;

  /** React Native's spelling of the same id. */
  testID?: string;

  /** The house spelling of the same id. */
  dataTestId?: string;
}
