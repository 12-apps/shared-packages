import CancelIcon from '@mui/icons-material/Cancel';
import { Chip as MuiChip } from '@mui/material';
import { forwardRef } from 'react';

import {
  avatarFor,
  chipRole,
  chipStyles,
  iconWithTestId,
  isClickable,
  makeKeyDownHandler,
  makeTestId,
} from './Chip.helpers';
import type { ChipProps } from './Chip.types';

type MuiChipColor =
  | 'primary'
  | 'secondary'
  | 'error'
  | 'info'
  | 'success'
  | 'warning'
  | 'default';

export const Chip = forwardRef<HTMLDivElement, ChipProps>(({
  label,
  variant = 'filled',
  size = 'medium',
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
  ...props
}, ref) => {
  const testId = makeTestId(dataTestId);
  const clickable = isClickable(disabled, onClick, selectable);

  return (
    <MuiChip
      ref={ref}
      label={<span data-testid={testId('label')}>{label}</span>}
      variant={variant}
      size={size}
      color={color as MuiChipColor | undefined}
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
      data-testid={dataTestId || 'chip'}
      sx={chipStyles({ variant, selected, clickable, disabled })}
      {...props}
    />
  );
});

Chip.displayName = 'Chip';
