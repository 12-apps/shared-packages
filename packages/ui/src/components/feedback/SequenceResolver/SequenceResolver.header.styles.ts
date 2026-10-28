import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { rem, sxRem } from '../../../tokens/relative';
import { SEQUENCE_METRICS as M } from './SequenceResolver.metrics';

/**
 * THE HEADER OF A RUN WITH "VER TODOS (N)" (FUT-3825). A resolver without an
 * overview keeps the header it always had (`SequenceResolver.styles.ts`).
 *
 * Back · the step label · "Ver todos (N)" · close on ONE line, the progress
 * bar under them at full width, nothing cut. On a narrow chrome (a phone
 * under 375px) Back is its chevron alone, a 44px target, and the step label
 * takes its own line under the bar. On a wider one only a long host label is
 * cut, with an ellipsis.
 */

/** The container the narrow layout answers to (container queries, never media queries). */
export const seeAllFrameSx: SxProps<Theme> = { containerType: 'inline-size', minWidth: 0 };

function narrow(theme: Theme): string {
  return `@container (max-width: ${rem(theme, M.narrowChrome)})`;
}

export const seeAllGridSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, max-content) minmax(0, 1fr) auto auto',
  gridTemplateAreas: '"back label . see close" "bar bar bar bar bar"',
  alignItems: 'center',
  rowGap: 2.25,
  '& > [data-sr-back]': { gridArea: 'back', mr: 0.75 },
  '& > [data-sr-label]': {
    gridArea: 'label',
    fontSize: sxRem(M.stepLabel),
    fontWeight: 500,
    color: 'text.secondary',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '& > [data-sr-see]': { gridArea: 'see', ml: 1.5 },
  '& > [data-sr-close]': { gridArea: 'close', ml: 1.5 },
  '& > [data-sr-bar]': { gridArea: 'bar', minWidth: 0 },
  [narrow(theme)]: {
    gridTemplateAreas: '"back . . see close" "bar bar bar bar bar" "label label label label label"',
    // Its own line under the full-width bar, whole: a long one wraps rather than being cut.
    '& > [data-sr-label]': { mt: -1.25, overflow: 'visible', whiteSpace: 'normal' },
    // Parent class + attribute: over the Button's own size rules (MUI's 64px minimum width).
    '& > [data-sr-back]': {
      mr: 0,
      width: rem(theme, M.touchTarget),
      minWidth: rem(theme, M.touchTarget),
      height: rem(theme, M.touchTarget),
      px: 0,
      '& [data-back-word]': { display: 'none' },
      '& .MuiButton-startIcon': { m: 0 },
    },
  },
});

/** "Ver todos (N)": a text button on the header's line, always whole. */
export function seeAllButtonSx(touch: boolean): SxProps<Theme> {
  const base = { flex: 'none', whiteSpace: 'nowrap' } as const;
  return touch ? { ...base, minHeight: sxRem(M.touchTarget) } : base;
}
