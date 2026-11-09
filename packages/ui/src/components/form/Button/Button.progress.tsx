import CircularProgress from '@mui/material/CircularProgress/index.js';
import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import * as React from 'react';

import { Progress } from '../../data-display/Progress';
import type { ColorValue } from '../../../tokens/vocabulary';
import { useFormBusy } from '../FormHold/FormHold';
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

/**
 * The look while it fills: the button's own colour, washed out, is the track;
 * the fill is the colour itself. Hover and focus keep it — a bar that changes
 * shade under the pointer reads as a second state.
 */
export function buttonProgressStyles(theme: Theme, color: string): CSSObject {
  const palette = getColorFromTheme(theme, color);
  // Washed out enough to read as "not yet", dark enough that the label on it
  // keeps a readable contrast (the prototype's track sits near two thirds).
  const track = alpha(palette.main, 0.65);
  return {
    '&&': { backgroundColor: track, color: palette.contrastText, borderColor: 'transparent', cursor: 'progress' },
    '&&:hover': { backgroundColor: track },
  };
}

const FILL_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  pointerEvents: 'none',
};

const LABEL_STYLE: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5em',
};

/** The fill behind the label, and the label; a spinner instead when there is no fraction. */
export function ButtonProgressContent({
  progress,
  color,
  testId,
}: {
  progress: ButtonProgress;
  color: ColorValue;
  testId: (suffix: string) => string | undefined;
}): React.ReactElement {
  const known = progress.fraction !== null;
  const percent = known ? Math.round(Math.min(1, Math.max(0, progress.fraction ?? 0)) * 100) : undefined;
  return (
    <>
      {known && (
        // Decorative: the label carries the words, `aria-busy` the state.
        <span aria-hidden style={FILL_STYLE} data-testid={testId('progress-fill')} data-value={percent}>
          <Progress
            value={percent}
            color={color}
            sx={(theme: Theme) => ({
              height: '100%',
              width: '100%',
              borderRadius: 0,
              backgroundColor: 'transparent',
              '& .MuiLinearProgress-bar': { borderRadius: 0, transition: `transform ${theme.transitions.duration.short}ms linear` },
            })}
          />
        </span>
      )}
      <span style={LABEL_STYLE} data-testid={testId('progress-label')}>
        {!known && (
          <CircularProgress size="1em" color="inherit" disableShrink aria-hidden data-testid={testId('progress-spinner')} />
        )}
        {progress.label}
      </span>
    </>
  );
}
