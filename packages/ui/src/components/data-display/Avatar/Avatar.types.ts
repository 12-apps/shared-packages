import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { AvatarProps as MuiAvatarProps } from '@mui/material/Avatar';
import type React from 'react';

/**
 * The house scale, EXTENDED by one stop rather than replacing it.
 *
 * `xxl` is real — an avatar is the one component with a portrait size above the
 * scale's top — so it is added to `SizeValue` instead of the union being
 * rewritten by hand. Spelling all six out again is how the copy drifts.
 */
export type AvatarSize = SizeValue | 'xxl';
export type AvatarVariant = 'circle' | 'square' | 'rounded' | 'status';
export type AvatarStatus = 'online' | 'offline' | 'away' | 'busy';

export interface AvatarProps extends Omit<MuiAvatarProps, 'variant'> {
  /**
   * The variant of the avatar
   */
  variant?: AvatarVariant;

  /**
   * The size of the avatar
   */
  size?: AvatarSize;

  /**
   * Whether the avatar should have a glow effect
   */
  glow?: boolean;

  /**
   * Whether the avatar should have a pulse animation
   */
  pulse?: boolean;

  /**
   * Status indicator (only applies when variant is 'status')
   */
  status?: AvatarStatus;

  /**
   * Fallback text when no src is provided (typically initials)
   */
  fallback?: string;

  /**
   * Custom icon to display
   */
  icon?: React.ReactNode;

  /**
   * Whether to show a border around the avatar
   */
  bordered?: boolean;

  /**
   * Color of the avatar background when no image is provided
   */
  color?: ColorValue;

  /**
   * Whether the avatar is in a loading state
   */
  loading?: boolean;

  /**
   * Whether the avatar should be interactive (show hover effects)
   */
  interactive?: boolean;

  /**
   * Whether to show fallback content on image error
   */
  showFallbackOnError?: boolean;

  /**
   * Animation delay in milliseconds
   */
  animationDelay?: number;

  /**
   * Error handler for image loading
   */
  onError?: React.ReactEventHandler;

  /**
   * Click handler
   */
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;

  /**
   * Test ID for automated testing
   */
  dataTestId?: string;
}
