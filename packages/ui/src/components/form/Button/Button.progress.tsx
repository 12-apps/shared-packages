import CircularProgress from '@mui/material/CircularProgress/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import * as React from 'react';

import { rem } from '../../../tokens/relative';
import { useFormBusy } from '../FormHold/FormHold';
import { buttonProgressColors } from './Button.progress.colors';
import { getColorFromTheme } from './Button.styles';
import type { ButtonProgress } from './Button.types';

/**
 * The button AS the bar (FUT-4574's option C): while `progress` is set, the
 * button fills left to right behind `progress.label`, says it is busy, and a
 * press does nothing.
 *
 * It is `aria-disabled`, never `disabled`: it keeps its focus and its place in
 * the tab order, and its label — "Sending photo · ~5 s" — is the reason it will
 * not act, read where the person already is. A `disabled` button would drop the
 * focus and say nothing.
 */

/** What the press, the native `disabled` and the ARIA state are, all told. */
export interface ButtonPressState {
  disabled: boolean;
  ariaDisabled: true | undefined;
  ariaBusy: true | undefined;
  onClick: React.MouseEventHandler<HTMLElement> | undefined;
}

/** A press that does nothing — not even submit the form the button sits in. */
const swallowPress: React.MouseEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

interface PressInput {
  progress: ButtonProgress | undefined;
  loading: boolean;
  disabled: boolean | undefined;
  type: string | undefined;
  onClick: React.MouseEventHandler<HTMLElement> | undefined;
}

/**
 * A `type="submit"` button is held while its form is busy (`useFormBusy`): that
 * is what keeps Save from running while a photo still uploads. Any other
 * button is NOT held unless its host opts in, so navigation stays live.
 */
export function useButtonPress({ progress, loading, disabled, type, onClick }: PressInput): ButtonPressState {
  const busy = useFormBusy();
  if (progress) return { disabled: false, ariaDisabled: true, ariaBusy: true, onClick: swallowPress };
  const held = type === 'submit' && busy;
  return {
    disabled: Boolean(disabled || loading || held),
    ariaDisabled: undefined,
    ariaBusy: loading ? true : undefined,
    onClick,
  };
}

/** The fill's own element, found by the button's styles. */
const FILL_ATTR = 'data-button-progress-fill';

/**
 * The look while it fills: the track is the button's colour shaded until its
 * label reads (4.5:1, `Button.progress.colors.ts`), the fill a further shade of
 * it. Hover keeps it — a bar that changes shade under the pointer reads as a
 * second state. The fill grows with a short transition, none under reduced
 * motion.
 */
export function buttonProgressStyles(theme: Theme, color: string): CSSObject {
  const palette = getColorFromTheme(theme, color);
  const { track, fill } = buttonProgressColors(palette.main, palette.contrastText);
  return {
    '&&': { backgroundColor: track, color: palette.contrastText, borderColor: 'transparent', cursor: 'progress' },
    '&&:hover': { backgroundColor: track },
    [`& [${FILL_ATTR}]`]: {
      backgroundColor: fill,
      transition: `width ${theme.transitions.duration.short}ms linear`,
      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
    },
  };
}

/** Clips the fill to the button's own shape at every width, 5 % and 100 % included. */
const CLIP_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  overflow: 'hidden',
  pointerEvents: 'none',
};

const fillStyle = (percent: number): React.CSSProperties => ({
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: `${percent}%`,
});

/**
 * The fill behind the label, and the label; the spinner `loading` uses instead
 * when there is no fraction. A plain span, not `data-display/Progress`: every
 * `Button` in every host bundles this file, and a LinearProgress would ride
 * along for the few that ever fill.
 */
export function ButtonProgressContent({
  progress,
  testId,
}: {
  progress: ButtonProgress;
  testId: (suffix: string) => string | undefined;
}): React.ReactElement {
  const theme = useTheme();
  const known = progress.fraction !== null;
  const percent = Math.round(Math.min(1, Math.max(0, progress.fraction ?? 0)) * 100);
  return (
    <>
      {known && (
        // Decorative: the label carries the words, `aria-busy` the state.
        <span aria-hidden style={CLIP_STYLE} data-testid={testId('progress-track')}>
          <span {...{ [FILL_ATTR]: '' }} style={fillStyle(percent)} data-testid={testId('progress-fill')} data-value={percent} />
        </span>
      )}
      <span
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: theme.spacing(1) }}
        data-testid={testId('progress-label')}
      >
        {!known && (
          <CircularProgress
            size={rem(theme, 16)}
            color="inherit"
            disableShrink
            aria-hidden
            data-testid={testId('progress-spinner')}
          />
        )}
        {progress.label}
      </span>
    </>
  );
}
