import type { SxProps, Theme } from '@mui/material/styles/index.js';

import { rem, sxRem } from '../../../tokens/relative';
import { softSignal } from '../../../tokens/surfaces';
import { SEQUENCE_METRICS } from './SequenceResolver.metrics';

/**
 * The paper's column: chrome (handle, header, progress) on top, the screen's
 * body below — one gap, as the prototype draws it. The body is the ONLY scroll
 * region, so Back, the step label, close and the progress never scroll away
 * with a long step. A title focused by script (`tabIndex={-1}`, the host's
 * included) is not a control and draws no focus ring.
 */
export const columnSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  gap: 2.25,
  '& [tabindex="-1"]:focus': { outline: 0 },
};

/** The chrome above the body: never shrinks, never scrolls. */
export const chromeSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: 2.25, flex: 'none' };

/** The screen's body: takes what the paper has left and scrolls inside it. */
export const scrollBodySx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2.25,
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  // The body's children keep their own height and the BODY scrolls: a
  // shrinking child (the intro's clipped list, a host's step) would
  // otherwise be crushed instead (320×568, 700×420).
  '& > *': { flexShrink: 0 },
  // Room inside the scroll edge for focus rings and the primary's shadow,
  // which an `overflow` box would otherwise clip; the negative margin keeps
  // the content where the prototype puts it.
  px: 0.5,
  mx: -0.5,
  pb: 0.5,
};

/**
 * The paper stops scrolling itself and lets its one child (the Dialog's padded
 * body box around `columnSx`) shrink, so the height cap reaches the body.
 * Below the sheet breakpoint the paper is also capped at 95% of the viewport.
 */
export function paperSx(touch: boolean): SxProps<Theme> {
  const share = SEQUENCE_METRICS.sheetMaxHeightPercent;
  const column = {
    overflowY: 'hidden',
    '& > *': { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 },
  } as const;
  if (!touch) return column;
  return {
    ...column,
    maxHeight: `${share}vh`,
    '@supports (height: 100dvh)': { maxHeight: `${share}dvh` },
  };
}

/** The end screen's button: a step down from the sentence, at the touch-target height on a phone. */
export function doneConfirmSx(): SxProps<Theme> {
  return { mt: 1, minHeight: sxRem(SEQUENCE_METRICS.touchTarget) };
}

/** "All in sequence": the prototype's 48px, and taller when a long label wraps. */
export const startAllSx: SxProps<Theme> = { height: 'auto', minHeight: sxRem(SEQUENCE_METRICS.startAllHeight) };

/** A button at the touch-target height below the sheet breakpoint; its own size above it. */
export function actionSx(touch: boolean): SxProps<Theme> {
  // On a phone the footer's actions share the row while both labels fit on
  // one line each; one that does not takes a full row instead of wrapping
  // word by word, and a label wider than the row itself wraps inside it
  // rather than pushing the sheet sideways.
  return touch
    ? { minHeight: sxRem(SEQUENCE_METRICS.touchTarget), flex: '1 1 max-content', minWidth: 0, maxWidth: '100%' }
    : {};
}

export const handleSx: SxProps<Theme> = {
  alignSelf: 'center',
  width: sxRem(SEQUENCE_METRICS.handle.width),
  height: sxRem(SEQUENCE_METRICS.handle.height),
  borderRadius: sxRem(SEQUENCE_METRICS.handle.height / 2),
  bgcolor: 'divider',
  flex: 'none',
};

export const headerSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1.5,
};

/** Back and the label; on a narrow sheet the label takes its own row rather than squeeze. */
export const headerStartSx: SxProps<Theme> = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 0.75,
  minWidth: 0,
};

export const stepLabelSx: SxProps<Theme> = {
  fontSize: sxRem(SEQUENCE_METRICS.stepLabel),
  fontWeight: 500,
  color: 'text.secondary',
  minWidth: 0,
};

export function closeButtonSx(touch: boolean): SxProps<Theme> {
  const size = touch ? SEQUENCE_METRICS.closeSize.touch : SEQUENCE_METRICS.closeSize.pointer;
  return { width: sxRem(size), height: sxRem(size), color: 'text.secondary', flex: 'none' };
}

export function backButtonSx(touch: boolean): SxProps<Theme> {
  return touch ? { flex: 'none', minHeight: sxRem(SEQUENCE_METRICS.touchTarget) } : { flex: 'none' };
}

export const titleSx: SxProps<Theme> = {
  fontSize: sxRem(SEQUENCE_METRICS.title),
  fontWeight: 500,
  lineHeight: 1.25,
  outline: 'none',
};

export const introListSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: sxRem(SEQUENCE_METRICS.listRadius),
  overflow: 'hidden',
  m: 0,
  p: 0,
  listStyle: 'none',
};

export function categoryRowSx(last: boolean): SxProps<Theme> {
  return {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  width: '100%',
  minHeight: sxRem(SEQUENCE_METRICS.categoryMinHeight),
  px: 1.75,
  py: 1.25,
  textAlign: 'left',
  justifyContent: 'flex-start',
  borderBottom: last ? 0 : '1px solid',
  borderColor: 'divider',
  '&:hover': { bgcolor: 'action.hover' },
  '&.Mui-focusVisible': { bgcolor: 'action.focus' },
  };
}

export const countBadgeSx: SxProps<Theme> = (theme: Theme) => ({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  minWidth: rem(theme, SEQUENCE_METRICS.countBadge),
  height: rem(theme, SEQUENCE_METRICS.countBadge),
  px: 0.75,
  borderRadius: rem(theme, SEQUENCE_METRICS.countBadge / 2),
  bgcolor: softSignal(theme, 'error'),
  // The signal's deep step on its soft ground; the light step on a dark one.
  color: theme.palette.mode === 'dark' ? 'error.light' : 'error.dark',
  fontWeight: 500,
});

export const categoryTextSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.25,
  flex: '1 1 auto',
  minWidth: 0,
};

export const categoryDescriptionSx: SxProps<Theme> = {
  fontSize: sxRem(SEQUENCE_METRICS.categoryDescription),
  color: 'text.secondary',
};

/**
 * The step's footer, as the prototype draws each kind:
 * - phone: the actions share the row (a label that does not fit takes a full
 *   row), no hairline;
 * - pointer, `'split'`: two equal full-width columns, no hairline (limits, a purchase);
 * - pointer, `'end'`: auto-width actions, right-aligned, over a hairline (restock).
 */
export function footerSx(touch: boolean, layout: 'end' | 'split'): SxProps<Theme> {
  if (touch) return { display: 'flex', flexWrap: 'wrap', gap: 1.25 };
  if (layout === 'split') {
    return { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: 1.25 };
  }
  return {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 1.25,
    pt: 1.5,
    borderTop: '1px solid',
    borderColor: 'divider',
  };
}

export function tertiarySx(touch: boolean): SxProps<Theme> {
  return touch ? { alignSelf: 'flex-start', minHeight: sxRem(SEQUENCE_METRICS.touchTarget) } : { alignSelf: 'flex-start' };
}

export const doneSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1.25,
  py: 1.5,
  textAlign: 'center',
};

export const doneIconSx: SxProps<Theme> = {
  fontSize: sxRem(SEQUENCE_METRICS.doneIcon),
  color: 'success.main',
};

export const doneTitleSx: SxProps<Theme> = {
  fontSize: sxRem(SEQUENCE_METRICS.doneTitle),
  fontWeight: 500,
  outline: 'none',
};

/** The overview's title, in the header row where a step shows its label. */
export const overviewTitleSx: SxProps<Theme> = {
  fontSize: sxRem(SEQUENCE_METRICS.overviewTitle),
  fontWeight: 500,
  lineHeight: 1.3,
  outline: 'none',
  minWidth: 0,
};

/**
 * One kind: its words take the width and its pick keeps its size on the right,
 * a hairline under it. Where the words would have less than `overviewTextMin`
 * beside the pick (a 320px phone), the pick drops under them instead of the
 * label breaking word by word.
 */
export const overviewRowSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 1.5,
  rowGap: 1,
  py: 1.5,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '& > :not(button)': { flex: `1 1 ${rem(theme, SEQUENCE_METRICS.overviewTextMin)}`, minWidth: 0 },
  '& > button': { flex: 'none' },
});

/** "Continue in sequence": start-aligned under a hairline, as the prototype draws it. */
export const overviewFooterSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'flex-start',
  pt: 2,
  mt: 2,
  borderTop: '1px solid',
  borderColor: 'divider',
};

/**
 * The step's own wrapper: no box of its own while it shows (its parts stay the
 * body's flex items, keeping the body's gap and their height), nothing at all
 * while the overview covers it.
 */
export function stepScreenSx(hidden: boolean): SxProps<Theme> {
  return hidden ? { display: 'none' } : { display: 'contents', '& > *': { flexShrink: 0 } };
}
