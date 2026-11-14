/**
 * The heat map's colours, chosen for CONTRAST in the theme they are drawn in
 * (FUT-4063). A tint is flattened onto the card's ground, and the ink is the
 * first candidate that reads at 4.5:1 on it — the role's own dark shade in a
 * light theme, its light shade in a dark one, then the palette's contrast text
 * — so a host palette or night mode never leaves a figure unreadable.
 */
import type { Theme } from '@mui/material/styles/index.js';

import { blend, decomposeColor, getContrastRatio } from '../../../tokens/color';
import type { HeatMapTone } from './HeatMap.types';

/** The text contrast the figures are held to (WCAG AA, body size). */
const READABLE_CONTRAST = 4.5;

/** A colour's own opacity, 1 when it states none. */
function opacityOf(color: string): number {
  const { type, values } = decomposeColor(color);
  return type.endsWith('a') ? (values[3] ?? 1) : 1;
}

/** A colour as it shows over `ground`: its own alpha (if any) flattened. */
function flatten(color: string, ground: string): string {
  return blend(ground, color, opacityOf(color));
}

/**
 * `color` washed over the theme's card ground at `amount` (times its own
 * alpha), as one opaque colour — what the reader actually sees.
 */
export function tintOver(theme: Theme, color: string, amount: number): string {
  const ground = flatten(theme.palette.background.paper, theme.palette.background.default);
  return blend(ground, color, amount * opacityOf(color));
}

/**
 * The first ink that reads at {@link READABLE_CONTRAST} on `background`; when
 * none does, the one that reads best. The palette's own contrast text is
 * always the last candidate, so there is always an answer.
 */
export function readableInk(theme: Theme, background: string, candidates: readonly string[]): string {
  const inks = [...candidates, theme.palette.getContrastText(background)];
  const scored = inks.map((ink) => ({ ink, ratio: getContrastRatio(flatten(ink, background), background) }));
  const passing = scored.find((entry) => entry.ratio >= READABLE_CONTRAST);
  if (passing) return passing.ink;
  return scored.reduce((best, entry) => (entry.ratio > best.ratio ? entry : best)).ink;
}

/** A role's ink candidate for the theme's mode: its dark shade on light, its light shade on dark. */
export function roleInk(theme: Theme, role: 'warning' | 'info'): string {
  const palette = theme.palette[role];
  return theme.palette.mode === 'dark' ? palette.light : palette.dark;
}

const TINTS: Record<Exclude<HeatMapTone, 'empty'>, { role: 'warning' | 'info'; amount: number }> = {
  'above-strong': { role: 'warning', amount: 0.45 },
  above: { role: 'warning', amount: 0.22 },
  'below-strong': { role: 'info', amount: 0.24 },
  below: { role: 'info', amount: 0.1 },
};

/**
 * One tone's fill and ink. Roles only: above is `warning` (amber), at or under
 * is `info`, never `primary` (a red brand would paint good cells as faults);
 * no figure is the disabled surface with the secondary ink.
 */
export function heatMapToneColors(tone: HeatMapTone, theme: Theme): { backgroundColor: string; color: string } {
  if (tone === 'empty') {
    const backgroundColor = tintOver(theme, theme.palette.action.disabledBackground, 1);
    return { backgroundColor, color: readableInk(theme, backgroundColor, [theme.palette.text.secondary]) };
  }
  const { role, amount } = TINTS[tone];
  const backgroundColor = tintOver(theme, theme.palette[role].main, amount);
  return { backgroundColor, color: readableInk(theme, backgroundColor, [roleInk(theme, role)]) };
}
