import type { Theme } from '@mui/material/styles/index.js';
import type { CSSObject } from '@mui/material/styles/index.js';

import { blend, darken, decomposeColor, getContrastRatio, getLuminance, lighten } from '../../../tokens/color';
import { fieldEdge } from '../../../tokens/field-edge';
import { absoluteInk } from '../../../tokens/ink';
import { softSignal, surfaces } from '../../../tokens/surfaces';
import type { ScheduleBlockTone } from './ScheduleGrid.types';

/** WCAG AA for a block's text (12px, not large): every tone's ink clears it on its ground. */
export const TONE_TEXT_CONTRAST = 4.5;

/** A translucent colour as it shows over an opaque `ground`. */
function flatten(ground: string, overlay: string): string {
  const { values, type } = decomposeColor(overlay);
  const opacity = type.endsWith('a') ? (values[3] ?? 1) : 1;
  return blend(ground, overlay, opacity);
}

/** The ground a block with no fill of its own sits on: a cell (or a track) over the page. */
export function cellGround(theme: Theme): string {
  return flatten(theme.palette.background.default, theme.palette.action.hover);
}

/** The first ink that reads at {@link TONE_TEXT_CONTRAST} on `ground`; none does, the one that reads best. */
export function readableInk(ground: string, candidates: readonly string[]): string {
  let best = candidates[0] ?? '';
  let bestRatio = -1;
  for (const ink of candidates) {
    const ratio = getContrastRatio(flatten(ground, ink), ground);
    if (ratio >= TONE_TEXT_CONTRAST) return ink;
    if (ratio > bestRatio) [best, bestRatio] = [ink, ratio];
  }
  return best;
}

/** `color`, then ten steps of it towards whichever end reads on `ground` — the hue kept as long as it can be. */
function deepening(color: string, ground: string): string[] {
  const toward = getLuminance(ground) > LUMINANCE_MIDPOINT ? darken : lighten;
  return Array.from({ length: 11 }, (_, step) => (step === 0 ? color : toward(color, step / 10)));
}

/** Where black and white read equally well on a ground (WCAG luminance). */
const LUMINANCE_MIDPOINT = 0.179;

/**
 * The signal's readable ink on a ground that is not its own colour: its deep
 * step on a light ground, its light step on a dark one, deepened further until
 * it reads at 4.5:1 (MUI's `warning.dark` is 3.6:1 on a light cell).
 */
export function signalInk(theme: Theme, signal: 'warning' | 'success', ground: string): string {
  const step = theme.palette.mode === 'dark' ? theme.palette[signal].light : theme.palette[signal].dark;
  return readableInk(ground, deepening(step, ground));
}

/**
 * The ink on a solid signal fill: the palette's own `contrastText` when it
 * reads (a host's brand decision), else the page's own text, else black or
 * white — MUI's default `warning` has white at 3.1:1 on its orange; the
 * prototype writes it in the dark ink.
 */
function inkOnFill(theme: Theme, fill: string, incumbent: string): string {
  const { black, white } = absoluteInk(theme);
  return readableInk(fill, [incumbent, theme.palette.text.primary, black, white]);
}

/**
 * How a block of each tone is drawn — in the week grid and on the day ruler
 * alike, so one tone reads the same in both views. `dashedPlan` is the ruler's
 * escala block (a dashed outline over a faint ground); the grid's plan block is
 * a raised chip. Never colour alone: every tone also carries its note text.
 */
export function blockToneStyles(theme: Theme, tone: ScheduleBlockTone, dashedPlan = false): CSSObject {
  const hairline = '1px solid';
  switch (tone) {
    case 'late':
      return {
        backgroundColor: theme.palette.warning.main,
        color: inkOnFill(theme, theme.palette.warning.main, theme.palette.warning.contrastText),
        border: `${hairline} ${theme.palette.warning.main}`,
      };
    case 'away':
    case 'uncovered':
      return {
        backgroundColor: 'transparent',
        color: signalInk(theme, 'warning', cellGround(theme)),
        border: `1px dashed ${theme.palette.warning.main}`,
      };
    case 'onduty':
      return {
        backgroundColor: softSignal(theme, 'success'),
        color: theme.palette.text.primary,
        border: `${hairline} ${theme.palette.success.main}`,
      };
    case 'plan':
    default:
      return dashedPlan
        ? {
            backgroundColor: theme.palette.action.hover,
            color: theme.palette.text.primary,
            border: `1px dashed ${theme.palette.text.secondary}`,
          }
        : {
            backgroundColor: surfaces(theme).raised,
            color: theme.palette.text.primary,
            border: `${hairline} ${fieldEdge(theme, surfaces(theme).raised)}`,
          };
  }
}

/**
 * A break inside a block (a meal break): the page's own ground with diagonal
 * stripes of the disabled action colour, opaque, so the block reads as CUT there in any
 * tone, light or dark. `stripe` / `period` are CSS lengths (a stripe and the
 * stripe plus its gap).
 */
export function breakHatch(theme: Theme, stripe: string, period: string): string {
  const ink = theme.palette.action.disabled;
  const ground = theme.palette.background.default;
  return `repeating-linear-gradient(135deg, ${ink} 0, ${ink} ${stripe}, ${ground} ${stripe}, ${ground} ${period}), ${ground}`;
}

/** The thin bar under a ruler row that says the shift is really running. */
export function actualBarColor(theme: Theme): string {
  return theme.palette.success.main;
}
