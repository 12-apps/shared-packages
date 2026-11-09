import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { Progress } from '../../data-display/Progress';
import { VISUALLY_HIDDEN_SX } from '../../../platform/visually-hidden';
import { rem } from '../../../tokens/relative';
import { useUploadTimeLeft } from './UploadProgress.hooks';
import {
  UPLOAD_STAGE_COUNT,
  type UploadProgressCopy,
  type UploadProgressProps,
  type UploadProgressValue,
} from './UploadProgress.types';

/**
 * Where a photo is, while it goes up: the stage, a bar, and the time left.
 *
 * Three stages, in the order an upload lives them — the browser re-encoding
 * (`preparing`, with its step "1 of 3"), the bytes going up (`sending`, with a
 * percentage), the server cutting its crops (`saving`). Every number is the
 * caller's estimate or nothing: a stage that cannot be estimated — `saving`
 * always, any stage whose fraction is unknown — is a spinner and the stage
 * word, no bar and no number (the spinner stands in, by the owner's decision).
 *
 * Accessibility: the stage word is a polite live region (`role="status"`) and
 * is the ONLY text in it, so a screen reader hears each stage change once and
 * never every percent. The region stays mounted, empty, while idle: a live
 * region created together with its first text is often not announced, and
 * that first text is the upload starting. The bar is a `progressbar` named by
 * the stage, with `aria-valuenow`.
 */

function stageWord(progress: UploadProgressValue, copy: UploadProgressCopy): string {
  return copy[progress.stage];
}

function percentOf(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/** The figure at the right of the stage word: the step while preparing, else the percentage. */
function figureOf(progress: UploadProgressValue, copy: UploadProgressCopy): string | null {
  if (progress.fraction === null) return null;
  if (progress.stage === 'preparing') return copy.step(progress.step ?? 1, UPLOAD_STAGE_COUNT);
  return copy.percent(percentOf(progress.fraction));
}

const part = (dataTestId: string, suffix: string): string => `${dataTestId}-${suffix}`;

function Bar({
  progress,
  label,
  dataTestId,
}: {
  progress: UploadProgressValue;
  label: string;
  dataTestId: string;
}): React.ReactElement {
  return (
    <Progress
      size="sm"
      value={percentOf(progress.fraction ?? 0)}
      aria-label={label}
      dataTestId={part(dataTestId, 'bar')}
    />
  );
}

/** The spinner a stage with no estimate shows. `disableShrink`: a constant arc, never a dot mid-animation. */
function Spinner({ dataTestId }: { dataTestId: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <CircularProgress
      size={rem(theme, 16)}
      thickness={5}
      disableShrink
      aria-hidden
      data-testid={part(dataTestId, 'spinner')}
    />
  );
}

const ROW_SX = { display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 } as const;

/** No estimate to draw: `saving`, or a stage whose fraction is unknown. */
const isSpinning = (progress: UploadProgressValue): boolean =>
  progress.stage === 'saving' || progress.fraction === null;

/** The live region: the stage word and nothing else, at ONE place in the tree from idle on. */
function StageStatus({ word, hidden, dataTestId }: { word: string; hidden: boolean; dataTestId: string }): React.ReactElement {
  return (
    <Typography
      component="span"
      role="status"
      aria-live="polite"
      variant="body2"
      data-testid={part(dataTestId, 'stage')}
      sx={hidden ? VISUALLY_HIDDEN_SX : { fontWeight: 'fontWeightMedium', flex: 1, minWidth: 0 }}
    >
      {word}
    </Typography>
  );
}

function Caption({ children, testId }: { children: React.ReactNode; testId: string }): React.ReactElement {
  return (
    <Typography variant="caption" color="text.secondary" data-testid={testId}>
      {children}
    </Typography>
  );
}

interface Shown {
  /** The progress the bar draws, or `null` when there is no bar. */
  bar: UploadProgressValue | null;
  /** The stage word is visually hidden (idle, or the compact size). */
  hidden: boolean;
  word: string;
  spinning: boolean;
  figure: string | null;
  timeLine: string | null;
}

/** What one render shows; everything empty while idle. */
function shownOf(
  progress: UploadProgressValue | null,
  copy: UploadProgressCopy,
  time: ReturnType<typeof useUploadTimeLeft>,
  compact: boolean,
): Shown {
  if (!progress) return { bar: null, hidden: true, word: '', spinning: false, figure: null, timeLine: null };
  const spinning = isSpinning(progress);
  const format = time?.kind === 'total' ? copy.totalSecondsLeft : copy.secondsLeft;
  return {
    bar: spinning ? null : progress,
    hidden: compact,
    word: stageWord(progress, copy),
    spinning,
    figure: compact || spinning ? null : figureOf(progress, copy),
    timeLine: compact || !time ? null : format(time.seconds),
  };
}

export function UploadProgress({
  progress,
  copy,
  size = 'regular',
  dataTestId = 'upload-progress',
}: UploadProgressProps): React.ReactElement {
  const time = useUploadTimeLeft(progress);
  const shown = shownOf(progress, copy, time, size === 'compact');
  return (
    <Box
      data-testid={dataTestId}
      data-stage={progress?.stage ?? 'idle'}
      data-size={size}
      sx={{ display: 'flex', flexDirection: 'column', gap: shown.hidden ? 0 : 0.5, minWidth: 0 }}
    >
      <Box sx={ROW_SX}>
        {shown.spinning && <Spinner dataTestId={dataTestId} />}
        <StageStatus word={shown.word} hidden={shown.hidden} dataTestId={dataTestId} />
        {shown.figure && <Caption testId={part(dataTestId, 'figure')}>{shown.figure}</Caption>}
      </Box>
      {shown.bar && <Bar progress={shown.bar} label={shown.word} dataTestId={dataTestId} />}
      {shown.timeLine && <Caption testId={part(dataTestId, 'time')}>{shown.timeLine}</Caption>}
    </Box>
  );
}

UploadProgress.displayName = 'UploadProgress';
