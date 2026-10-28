import type { Theme } from '@mui/material/styles/index.js';
import type { CSSObject } from '@mui/material/styles/index.js';

import { fieldEdge } from '../../../tokens/field-edge';
import { softSignal, surfaces } from '../../../tokens/surfaces';
import type { ScheduleBlockTone } from './ScheduleGrid.types';

/**
 * The signal's readable ink on the page: its deep step on a light ground, its
 * light step on a dark one (the soft grounds and dashed outlines sit on the
 * page, not on the signal's own colour).
 */
function inkOf(theme: Theme, signal: 'warning' | 'success'): string {
  return theme.palette.mode === 'dark' ? theme.palette[signal].light : theme.palette[signal].dark;
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
        color: theme.palette.warning.contrastText,
        border: `${hairline} ${theme.palette.warning.main}`,
      };
    case 'away':
    case 'uncovered':
      return {
        backgroundColor: 'transparent',
        color: inkOf(theme, 'warning'),
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
 * A break inside a block (a meal break): diagonal stripes of the page's own
 * ground over the block, so the block reads as cut there in any tone, light or
 * dark. `stripe` is the stripe's width as a CSS length.
 */
export function breakHatch(theme: Theme, stripe: string, stripe2: string): string {
  const gap = theme.palette.background.default;
  return `repeating-linear-gradient(135deg, ${gap} 0, ${gap} ${stripe}, transparent ${stripe}, transparent ${stripe2})`;
}

/** The thin bar under a ruler row that says the shift is really running. */
export function actualBarColor(theme: Theme): string {
  return theme.palette.success.main;
}
