import Avatar from '@mui/material/Avatar/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type { KeyboardEvent, ReactElement } from 'react';
import React from 'react';

import { chipKeyAction, type ChipKeyArgs } from './Chip.helpers';
import { alpha } from '@mui/material/styles/index.js';

import {
  CHIP_SIZES,
  CHIP_TRANSITION_EASING,
  CHIP_TRANSITION_MS,
  HOVER_LIFT_PX,
  HOVER_SHADOW,
  SOFT_GROUND_ALPHA,
  SOFT_HOVER_ALPHA,
} from './Chip.metrics';
import type { ChipProps } from './Chip.types';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems, sxRem } from '../../../tokens/relative';

/**
 * A chip is not a native control, so the two keyboard conventions it stands in
 * for are wired by hand: Delete/Backspace removes it, Enter/Space activates it.
 * The DECISION is `chipKeyAction`, which the native half reads too.
 */
export const makeKeyDownHandler =
  (args: ChipKeyArgs & { onClick?: () => void; onDelete?: () => void }) =>
  (event: KeyboardEvent): void => {
    const action = chipKeyAction(event.key, args);
    if (action === null) return;
    event.preventDefault();
    if (action === 'delete') {
      args.onDelete?.();
      return;
    }
    args.onClick?.();
  };

export const avatarFor = (
  avatar: ChipProps['avatar'],
  avatarSrc?: string,
): ReactElement | undefined => {
  if (avatar && React.isValidElement(avatar)) {
    return avatar;
  }
  if (avatarSrc) {
    const { avatarSize } = CHIP_SIZES.medium;
    return <Avatar src={avatarSrc} sx={{ width: sxRem(avatarSize), height: sxRem(avatarSize) }} />;
  }
  return undefined;
};

interface ChipStyleArgs {
  variant: ChipProps['variant'];
  color?: ChipProps['color'];
  selected?: boolean;
  clickable?: boolean;
  disabled?: boolean;
}

/** The lift's shadow, per mode — the same numbers the native chip reads. */
const hoverShadow = (theme: Theme): string =>
  `0 ${rems(theme, HOVER_SHADOW.offsetY, HOVER_SHADOW.blur)} ${shadowInk(
    theme,
    theme.palette.mode === 'dark' ? HOVER_SHADOW.alphaDark : HOVER_SHADOW.alphaLight,
  )}`;

/**
 * Selection styling uses SEMANTIC palette tokens (not hardcoded rgba). A filled
 * selected chip keeps MUI's solid `color.main` + contrast text (clear active
 * state); an outlined selected chip gets a subtle theme-driven `action.selected`
 * tint so it reads as active without muddying the fill.
 */
/** The palette entry a colour paints with; `neutral` has none and takes the ink. */
const paletteKey = (color: NonNullable<ChipProps['color']>): 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' | null => {
  if (color === 'neutral') return null;
  return color === 'danger' ? 'error' : color;
};

/** `soft`: the colour's tint for a ground, its dark step for ink (and the icon). */
const softStyles = (color: NonNullable<ChipProps['color']>): SxProps<Theme> => {
  const key = paletteKey(color);
  const ground = (theme: Theme): string =>
    key ? alpha(theme.palette[key].main, SOFT_GROUND_ALPHA) : theme.palette.action.selected;
  const ink = (theme: Theme): string => (key ? theme.palette[key].dark : theme.palette.text.secondary);
  return {
    backgroundColor: ground,
    color: ink,
    '& .MuiChip-icon': { color: ink },
    '&.MuiChip-clickable:hover': {
      backgroundColor: (theme: Theme) => (key ? alpha(theme.palette[key].main, SOFT_HOVER_ALPHA) : theme.palette.action.hover),
    },
  };
};

export const chipStyles = ({
  variant,
  color = 'primary',
  selected,
  clickable,
  disabled,
}: ChipStyleArgs): SxProps<Theme> => {
  const lifts = clickable && !disabled;

  return {
    ...(variant === 'soft' ? (softStyles(color) as object) : {}),
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
        transform: (theme: Theme) => `translateY(${rem(theme, -HOVER_LIFT_PX)})`,
        boxShadow: (theme: Theme) => hoverShadow(theme),
      }),
    },
    '&:active': {
      ...(lifts && {
        transform: 'translateY(0px)',
      }),
    },
    transition: `all ${CHIP_TRANSITION_MS / 1000}s ${CHIP_TRANSITION_EASING}`,
  };
};

export const iconWithTestId = (
  icon: ChipProps['icon'],
  testId: string,
): ReactElement | undefined =>
  icon && React.isValidElement(icon)
    ? React.cloneElement(icon as ReactElement, {
        'data-testid': testId,
      } as Record<string, unknown>)
    : undefined;
