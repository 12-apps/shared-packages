import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import type * as React from 'react';

import { blend, decomposeColor, getContrastRatio } from '../../../tokens/color';
import { rem } from '../../../tokens/relative';

/**
 * A button that cannot act RIGHT NOW but stays in the tab order (`aria-disabled`):
 * a submit held while its form waits on an upload, a settings card's Save
 * while its logo uploads. It must look unavailable — the theme's disabled
 * background — and still be read: its label keeps at least 3:1 against that
 * background (a disabled control's label is exempt from WCAG, but a person
 * still has to read WHAT is held).
 */
export const HELD_LABEL_MIN_CONTRAST = 3;

/** `color` at its own alpha over `surface`, flattened to what the eye sees. */
function flatten(color: string, surface: string): string {
  const { type, values } = decomposeColor(color);
  const opacity = type === 'rgba' || type === 'hsla' ? (values[3] ?? 1) : 1;
  return blend(surface, color, opacity);
}

/** The tokens the held look reads — an MUI theme, or this package's `UiTheme`. */
export interface HeldTokens {
  palette: {
    action: { disabledBackground: string };
    background: { paper: string };
    text: { primary: string; secondary: string; disabled: string };
  };
}

export interface HeldColors {
  backgroundColor: string;
  color: string;
}

/**
 * The held look, from the theme's disabled tokens: `action.disabledBackground`
 * over the page, and the first of `text.disabled`, `text.secondary`,
 * `text.primary` that reads at {@link HELD_LABEL_MIN_CONTRAST} on it.
 */
export function heldColors(theme: HeldTokens): HeldColors {
  const backgroundColor = flatten(theme.palette.action.disabledBackground, theme.palette.background.paper);
  const inks = [theme.palette.text.disabled, theme.palette.text.secondary, theme.palette.text.primary];
  const color =
    inks.find((ink) => getContrastRatio(flatten(ink, backgroundColor), backgroundColor) >= HELD_LABEL_MIN_CONTRAST) ??
    theme.palette.text.primary;
  return { backgroundColor, color: flatten(color, backgroundColor) };
}

/** The held look as an inline style, for a button whose `sx` the caller cannot set. */
export function heldButtonStyle(theme: Theme): React.CSSProperties {
  return { ...heldColors(theme), boxShadow: 'none' };
}

/**
 * The keyboard ring of a focusable button that will not act: MUI draws none
 * but its ripple, which is no cue at all on a button that does nothing. Two
 * tones, so it reads on any page, light or dark: an ink ring 2 px out, in a
 * halo of the page surface.
 */
export function heldFocusRing(theme: Theme): CSSObject {
  const ring: CSSObject = {
    outline: `${rem(theme, 2)} solid ${theme.palette.text.primary}`,
    outlineOffset: rem(theme, 2),
    boxShadow: `0 0 0 ${rem(theme, 6)} ${theme.palette.background.paper}`,
  };
  return { '&&:focus-visible': ring, '&&.Mui-focusVisible': ring };
}

/** The held submit's styles: the held look, unchanged under the pointer, and the ring. */
export function buttonHeldStyles(theme: Theme): CSSObject {
  const look = { ...heldColors(theme), borderColor: 'transparent', boxShadow: 'none', cursor: 'default' };
  return { '&&': look, '&&:hover': look, ...heldFocusRing(theme) };
}
