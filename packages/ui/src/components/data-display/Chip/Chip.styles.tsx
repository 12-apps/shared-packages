import Avatar from '@mui/material/Avatar/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type { KeyboardEvent, ReactElement } from 'react';
import React from 'react';

import { chipKeyAction, type ChipKeyArgs } from './Chip.helpers';
import { CHIP_SIZES, CHIP_TRANSITION_EASING, CHIP_TRANSITION_MS, HOVER_LIFT_PX, HOVER_SHADOW } from './Chip.metrics';
import type { ChipProps } from './Chip.types';

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
    return <Avatar src={avatarSrc} sx={{ width: avatarSize, height: avatarSize }} />;
  }
  return undefined;
};

interface ChipStyleArgs {
  variant: ChipProps['variant'];
  selected?: boolean;
  clickable?: boolean;
  disabled?: boolean;
}

/** The lift's shadow, per mode — the same numbers the native chip reads. */
const hoverShadow = (mode: Theme['palette']['mode']): string =>
  `0 ${HOVER_SHADOW.offsetY}px ${HOVER_SHADOW.blur}px rgba(0, 0, 0, ${
    mode === 'dark' ? HOVER_SHADOW.alphaDark : HOVER_SHADOW.alphaLight
  })`;

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
        transform: `translateY(-${HOVER_LIFT_PX}px)`,
        boxShadow: (theme: Theme) => hoverShadow(theme.palette.mode),
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
