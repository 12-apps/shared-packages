import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { onMedia, scrim, sheen } from '../../../tokens/ink';
import { rem } from '../../../tokens/scales';

/** Attributes every indicator variant carries, whatever it draws. */
export const indicatorAttrs = (index: number, isActive: boolean, label: string) => ({
  'aria-label': label,
  'data-testid': `carousel-indicator-${index}`,
  'data-active': isActive,
});

/**
 * A two-tone keyboard ring that reads on the page AND on a photo, light or
 * dark: the ink ring (`text.primary`) sits in a halo of the page surface, so
 * whichever side the backdrop is close to, the other tone still contrasts 3:1.
 * Inner gap 2 px, ring 2 px, outer edge 2 px (design px).
 */
export const focusRing = (theme: Theme): CSSObject => ({
  outline: `${rem(theme, 2)} solid ${theme.palette.text.primary}`,
  outlineOffset: rem(theme, 2),
  boxShadow: `0 0 0 ${rem(theme, 6)} ${theme.palette.background.paper}`,
});

/**
 * The approved storefront arrow: a near-opaque page-surface circle with an ink
 * chevron, the same in dark with the dark tokens. Opt-in through
 * `arrowVariant="surface"`; the default arrows are untouched.
 */
export const surfaceArrowSx = (theme: Theme): CSSObject => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.95),
  color: theme.palette.text.primary,
  opacity: 1,
  '&:hover': { backgroundColor: theme.palette.background.paper, opacity: 1 },
});

/** A pill's colours: ink for the current one, a ≥3:1 grey for the rest; light-on-scrim over a photo. */
export const pillColours = (theme: Theme, isActive: boolean, onPhoto: boolean): string => {
  if (onPhoto) return isActive ? onMedia(theme) : sheen(theme, 0.7);
  return isActive ? theme.palette.text.primary : alpha(theme.palette.text.primary, 0.55);
};

/** Pills drawn over the photo sit on a scrim chip so they hold contrast on any picture. */
export const pillRowOnPhoto = (theme: Theme): CSSObject => ({
  backgroundColor: scrim(theme, 0.5),
  borderRadius: theme.spacing(2),
  padding: `0 ${theme.spacing(0.5)}`,
});
