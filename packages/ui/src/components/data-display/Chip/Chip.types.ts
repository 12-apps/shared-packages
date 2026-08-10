import type { ReactNode } from 'react';

export type ChipVariant = 'filled' | 'outlined';
export type ChipSize = 'small' | 'medium';

/**
 * The colours a chip can actually draw.
 *
 * This is a CLOSED set on purpose. It was `string`, and the widening was not
 * free: `danger` — a real colour in the super-admin design system and the
 * obvious guess for "money is owed" — is not one of these, was accepted
 * silently, and reached MUI as an unknown value that falls back to the default
 * grey. The chip that most needed emphasis was the one that rendered without
 * any, and nothing failed to say so.
 *
 * Use `error` for the destructive/attention meaning.
 */
export type ChipColor =
  | 'primary'
  | 'secondary'
  | 'error'
  | 'info'
  | 'success'
  | 'warning'
  | 'default';

export interface ChipProps {
  /** Text content displayed in the chip */
  label: string;
  
  /** Visual style variant */
  variant?: ChipVariant;
  
  /** Size of the chip */
  size?: ChipSize;
  
  /** Theme color token. See {@link ChipColor} for why this is a closed set. */
  color?: ChipColor;
  
  /** Source URL for avatar image */
  avatarSrc?: string;
  
  /** Custom avatar React node (overrides avatarSrc) */
  avatar?: ReactNode;
  
  /** Leading icon React node */
  icon?: ReactNode;
  
  /** Current selection state */
  selected?: boolean;
  
  /** Enables selection toggle capability */
  selectable?: boolean;
  
  /** Shows delete button */
  deletable?: boolean;
  
  /** Disables all interactions */
  disabled?: boolean;
  
  /** Click/selection handler */
  onClick?: () => void;
  
  /** Delete action handler */
  onDelete?: () => void;
  
  /** Additional CSS classes */
  className?: string;

  /** Test ID for component testing */
  dataTestId?: string;
}