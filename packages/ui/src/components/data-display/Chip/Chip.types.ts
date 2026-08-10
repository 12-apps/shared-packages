import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { ReactNode } from 'react';

export type ChipVariant = 'filled' | 'outlined';

/**
 * The house size scale, abbreviated like every other component's.
 *
 * `Avatar`, `Badge`, `Progress`, `Input`, `Modal` and `Dialog` all use `sm`/`md`;
 * this was `'small' | 'medium'`, MUI's spelling, and the sole outlier in the
 * package. That was not merely inconsistent — callers wrote `size="sm"` because
 * every neighbouring component taught them to, it type-checked against the old
 * `ChipSize` nowhere and reached MUI as an unknown value, and the chip silently
 * rendered at the default `medium`. Twelve of them are doing that today.
 *
 * Only two entries, because a MUI chip only draws two. Inventing `lg` here would
 * put a size in the type that nothing can render.
 */
export type ChipSize = Extract<SizeValue, 'sm' | 'md'>;

/**
 * The colours a chip can draw — THE HOUSE VOCABULARY, identical to `ButtonProps`.
 *
 * `danger` and `neutral` are ours; the rest are MUI's own names already. That is
 * the same sentence `Button.tsx` carries, and deliberately so: `Button`, `Alert`,
 * `Text`, `Heading`, `Paragraph` and `Blockquote` all speak this vocabulary, so a
 * chip is the odd one out if it does not.
 *
 * This prop was `string`, and the widening was not free. `danger` — the house
 * word for the destructive meaning, and what every neighbouring component
 * accepts — reached MUI as an unknown value and fell back to the default grey.
 * The chip that most needed emphasis rendered without any, and nothing said so.
 *
 * The fix is NOT to reject `danger`. Rejecting it would punish a caller for
 * using the vocabulary the rest of the system taught them. The fix is for the
 * chip to speak it and translate at the MUI boundary, exactly as `Button` does.
 */
export type ChipColor = ColorValue;

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