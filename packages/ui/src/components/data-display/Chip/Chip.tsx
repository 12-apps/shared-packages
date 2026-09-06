import CancelIcon from '@mui/icons-material/Cancel';
import MuiChip from '@mui/material/Chip/index.js';
import { forwardRef } from 'react';

import { chipRole, isClickable, makeTestId } from './Chip.helpers';
import { chipMuiSize } from './Chip.metrics';
import {
  avatarFor,
  chipStyles,
  iconWithTestId,
  makeKeyDownHandler,
} from './Chip.styles';
import type { ChipProps } from './Chip.types';

type MuiChipColor =
  | 'primary'
  | 'secondary'
  | 'error'
  | 'info'
  | 'success'
  | 'warning'
  | 'default';

/**
 * `danger` and `neutral` are ours; the rest are MUI's own names already.
 *
 * The same boundary translation `Button` performs, and it must stay a
 * translation rather than a cast: a cast is what let `danger` through untouched
 * and had MUI silently fall back to grey.
 *
 * `neutral` maps to `default`, not to `inherit` as it does on a button. A chip's
 * unaccented state is a real palette entry with its own fill; `inherit` would
 * take the surrounding text colour and paint a chip that reads as disabled.
 */
const muiColorFor = (color: NonNullable<ChipProps['color']>): MuiChipColor => {
  if (color === 'danger') return 'error';
  return color === 'neutral' ? 'default' : color;
};

export const Chip = forwardRef<HTMLDivElement, ChipProps>(({
  label,
  variant = 'filled',
  size = 'md',
  color = 'primary',
  avatarSrc,
  avatar,
  icon,
  selected,
  selectable,
  deletable,
  disabled,
  onClick,
  onDelete,
  className,
  dataTestId,
  // React Native's spelling of the same id; it names the component on both
  // sides and must not reach the DOM as an attribute.
  testID,
  ...props
}, ref) => {
  const chipId = testID ?? dataTestId;
  const testId = makeTestId(chipId);
  const clickable = isClickable(disabled, onClick, selectable);

  return (
    <MuiChip
      ref={ref}
      label={<span data-testid={testId('label')}>{label}</span>}
      variant={variant}
      size={chipMuiSize(size)}
      color={muiColorFor(color)}
      avatar={avatarFor(avatar, avatarSrc)}
      icon={iconWithTestId(icon, testId('icon'))}
      onDelete={deletable ? onDelete : undefined}
      deleteIcon={deletable ? <CancelIcon data-testid={testId('delete')} /> : undefined}
      disabled={disabled}
      clickable={clickable}
      onClick={clickable ? onClick : undefined}
      onKeyDown={makeKeyDownHandler({ disabled, deletable, selectable, onClick, onDelete })}
      className={className}
      role={chipRole(selectable, onClick)}
      aria-selected={selectable ? selected : undefined}
      data-testid={chipId || 'chip'}
      sx={chipStyles({ variant, selected, clickable, disabled })}
      {...props}
    />
  );
});

Chip.displayName = 'Chip';
