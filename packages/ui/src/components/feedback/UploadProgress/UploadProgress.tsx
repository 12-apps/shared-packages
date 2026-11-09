import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { Progress } from '../../data-display/Progress';
import { SR_ONLY_SX } from '../../data-display/ScheduleGrid/ScheduleGrid.styles';
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
 * caller's estimate or nothing: `saving` has no honest one, so it is a spinner
 * and the stage word; a stage whose fraction is unknown draws an
 * indeterminate bar and no number.
 *
 * Accessibility: the stage word is a polite live region (`role="status"`) and
 * is the ONLY text in it, so a screen reader hears each stage change once and
 * never every percent. The bar is a `progressbar` named by the stage, with
 * `aria-valuenow` while it is determinate.
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
      value={progress.fraction === null ? undefined : percentOf(progress.fraction)}
      aria-label={label}
      dataTestId={part(dataTestId, 'bar')}
    />
  );
}

/** The spinner `saving` shows. `disableShrink`: a constant arc, never a dot mid-animation. */
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

/**
 * The live region: the stage word and nothing else. Each view keeps it at ONE
 * place in its tree across every stage, so it is never remounted — a fresh
 * live region is often not announced.
 */
function StageStatus({ word, hidden, dataTestId }: { word: string; hidden: boolean; dataTestId: string }): React.ReactElement {
  return (
    <Typography
      component="span"
      role="status"
      aria-live="polite"
      variant="body2"
      data-testid={part(dataTestId, 'stage')}
      sx={hidden ? SR_ONLY_SX : { fontWeight: 600, flex: 1, minWidth: 0 }}
    >
      {word}
    </Typography>
  );
}

interface ViewProps {
  progress: UploadProgressValue;
  copy: UploadProgressCopy;
  dataTestId: string;
}

function CompactView({ progress, copy, dataTestId }: ViewProps): React.ReactElement {
  const word = stageWord(progress, copy);
  return (
    <Box data-testid={dataTestId} data-stage={progress.stage} data-size="compact" sx={ROW_SX}>
      <StageStatus word={word} hidden dataTestId={dataTestId} />
      {progress.stage === 'saving' ? (
        <Spinner dataTestId={dataTestId} />
      ) : (
        <Bar progress={progress} label={word} dataTestId={dataTestId} />
      )}
    </Box>
  );
}

function Caption({ children, testId }: { children: React.ReactNode; testId: string }): React.ReactElement {
  return (
    <Typography variant="caption" color="text.secondary" data-testid={testId}>
      {children}
    </Typography>
  );
}

function RegularView({ progress, copy, dataTestId, timeLine }: ViewProps & { timeLine: string | null }): React.ReactElement {
  const word = stageWord(progress, copy);
  const spinning = progress.stage === 'saving';
  const figure = spinning ? null : figureOf(progress, copy);
  return (
    <Box
      data-testid={dataTestId}
      data-stage={progress.stage}
      data-size="regular"
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}
    >
      <Box sx={ROW_SX}>
        {spinning && <Spinner dataTestId={dataTestId} />}
        <StageStatus word={word} hidden={false} dataTestId={dataTestId} />
        {figure && <Caption testId={part(dataTestId, 'figure')}>{figure}</Caption>}
      </Box>
      {!spinning && <Bar progress={progress} label={word} dataTestId={dataTestId} />}
      {timeLine && <Caption testId={part(dataTestId, 'time')}>{timeLine}</Caption>}
    </Box>
  );
}

export function UploadProgress({
  progress,
  copy,
  size = 'regular',
  dataTestId = 'upload-progress',
}: UploadProgressProps): React.ReactElement | null {
  const time = useUploadTimeLeft(progress);
  if (!progress) return null;
  if (size === 'compact') return <CompactView progress={progress} copy={copy} dataTestId={dataTestId} />;
  const format = time?.kind === 'total' ? copy.totalSecondsLeft : copy.secondsLeft;
  return (
    <RegularView
      progress={progress}
      copy={copy}
      dataTestId={dataTestId}
      timeLine={time ? format(time.seconds) : null}
    />
  );
}

UploadProgress.displayName = 'UploadProgress';
