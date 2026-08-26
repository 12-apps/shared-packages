import Avatar from '@mui/material/Avatar/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type { KeyboardEvent, ReactElement } from 'react';
import React from 'react';

import type { ChipProps } from './Chip.types';

export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `chip-${suffix}`;

interface KeyHandlerArgs {
  disabled?: boolean;
  deletable?: boolean;
  selectable?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

const DELETE_KEYS = new Set(['Delete', 'Backspace']);
const ACTIVATE_KEYS = new Set(['Enter', ' ']);

/**
 * A chip is not a native control, so the two keyboard conventions it stands in for
 * are wired by hand: Delete/Backspace removes it, Enter/Space activates it.
 */
export const makeKeyDownHandler =
  ({ disabled, deletable, selectable, onClick, onDelete }: KeyHandlerArgs) =>
  (event: KeyboardEvent): void => {
    if (disabled) return;

    if (DELETE_KEYS.has(event.key) && deletable && onDelete) {
      event.preventDefault();
      onDelete();
      return;
    }

    if (ACTIVATE_KEYS.has(event.key) && (onClick || selectable)) {
      event.preventDefault();
      onClick?.();
    }
  };

export const avatarFor = (
  avatar: ChipProps['avatar'],
  avatarSrc?: string,
): ReactElement | undefined => {
  if (avatar && React.isValidElement(avatar)) {
    return avatar;
  }
  if (avatarSrc) {
    return <Avatar src={avatarSrc} sx={{ width: 24, height: 24 }} />;
  }
  return undefined;
};

interface ChipStyleArgs {
  variant: ChipProps['variant'];
  selected?: boolean;
  clickable?: boolean;
  disabled?: boolean;
}

/**
 * Selection styling uses SEMANTIC palette tokens (not hardcoded rgba). A filled
 * selected chip keeps MUI's solid `color.main` + contrast text (clear active
 * state); an outlined selected chip gets a subtle theme-driven `action.selected`
 * tint so it reads as active without muddying the fill.
 */
export const chipStyles = ({
  variant,
  selected,
  clickable,
  disabled,
}: ChipStyleArgs): SxProps<Theme> => {
  const lifts = clickable && !disabled;

  return {
    // Enhanced styling for outlined variant
    ...(variant === 'outlined' && {
      borderWidth: '1px',
      borderStyle: 'solid',
      backgroundColor: 'transparent',
    }),
    ...(selected &&
      variant === 'outlined' && {
        backgroundColor: (theme: Theme) => theme.palette.action.selected,
      }),
    '&:hover': {
      ...(lifts && {
        transform: 'translateY(-1px)',
        boxShadow: (theme: Theme) =>
          theme.palette.mode === 'dark'
            ? '0 4px 12px rgba(0, 0, 0, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.15)',
      }),
    },
    '&:active': {
      ...(lifts && {
        transform: 'translateY(0px)',
      }),
    },
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  };
};

/** `option` when the chip belongs to a selectable set, `button` when it merely acts. */
export const chipRole = (
  selectable?: boolean,
  onClick?: () => void,
): 'option' | 'button' | undefined => {
  if (selectable) return 'option';
  return onClick ? 'button' : undefined;
};

export const isClickable = (
  disabled?: boolean,
  onClick?: () => void,
  selectable?: boolean,
): boolean => !disabled && (Boolean(onClick) || Boolean(selectable));

export const iconWithTestId = (
  icon: ChipProps['icon'],
  testId: string,
): ReactElement | undefined =>
  icon && React.isValidElement(icon)
    ? React.cloneElement(icon as ReactElement, {
        'data-testid': testId,
      } as Record<string, unknown>)
    : undefined;
