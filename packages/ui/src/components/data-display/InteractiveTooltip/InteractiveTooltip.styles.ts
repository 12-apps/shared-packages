import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { absoluteInk, neutralTones, shadowInk, sheen } from '../../../tokens/ink';
import { rem, rems, sxRem } from '../../../tokens/relative';

const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const SIZE_MAP = {
  sm: { fontSize: sxRem(12), padding: (theme: Theme) => rems(theme, 4, 8) },
  md: { fontSize: sxRem(14), padding: (theme: Theme) => rems(theme, 6, 12) },
  lg: { fontSize: sxRem(16), padding: (theme: Theme) => rems(theme, 8, 16) },
} as const;

export const getSizeStyles = (
  size?: string,
): { fontSize: (theme: Theme) => string; padding: (theme: Theme) => string } =>
  SIZE_MAP[size as keyof typeof SIZE_MAP] || SIZE_MAP.md;

export const variantStyles = (theme: Theme, variant?: string): CSSObject => {
  switch (variant) {
    case 'default':
      return {
        backgroundColor: alpha(neutralTones(theme).inverseSurface, 0.92),
        color: absoluteInk(theme).white,
        boxShadow: `${rems(theme, 0, 4, 12)} ${shadowInk(theme, 0.3)}`,
      };
    case 'dark':
      return {
        backgroundColor: absoluteInk(theme).black,
        color: absoluteInk(theme).white,
        boxShadow: `${rems(theme, 0, 6, 16)} ${shadowInk(theme, 0.5)}`,
        border: `1px solid ${sheen(theme, 0.1)}`,
      };
    case 'light':
      return {
        backgroundColor: absoluteInk(theme).white,
        color: neutralTones(theme).inverseSurface,
        border: `1px solid ${alpha(neutralTones(theme).subtle, 0.4)}`,
        boxShadow: `${rems(theme, 0, 4, 16)} ${shadowInk(theme, 0.15)}`,
      };
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.75),
        backdropFilter: `blur(${rem(theme, 24)}) saturate(180%)`,
        WebkitBackdropFilter: `blur(${rem(theme, 24)}) saturate(180%)`,
        border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
        color: theme.palette.text.primary,
        boxShadow: `${rems(theme, 0, 8, 32)} ${shadowInk(theme, 0.12)}`,
      };
    default:
      return {};
  }
};

// glow and pulse are independent flags. The three combinations used to be spelled
// out one by one, but each is just the union of whichever flags are set.
export const emphasisStyles = (theme: Theme, glow?: boolean, pulse?: boolean): CSSObject => ({
  ...(glow && {
    boxShadow: `${rems(theme, 0, 0, 15, 3)} ${alpha(theme.palette.primary.main, 0.4)} !important`,
    filter: 'brightness(1.05)',
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});

/**
 * The tooltip's cap: 300 design px unless the caller says otherwise. `sx` has
 * always read a number of 1 or less as a fraction of the parent, and that stays so.
 */
export const tooltipCap =
  (maxWidth: number | undefined) =>
  (theme: Theme): string => {
    const cap = maxWidth ?? 300;
    return cap <= 1 && cap !== 0 ? `${cap * 100}%` : rem(theme, cap);
  };

export const arrowColor = (theme: Theme, variant?: string): string => {
  switch (variant) {
    case 'light':
      return absoluteInk(theme).white;
    case 'glass':
      return alpha(theme.palette.background.paper, 0.75);
    case 'dark':
      return absoluteInk(theme).black;
    default:
      return alpha(neutralTones(theme).inverseSurface, 0.92);
  }
};
