'use client';

import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import React, { useCallback, useId, useRef } from 'react';

import { Dialog } from '../Dialog';
import { currentOf, positionOf, progressOf, summaryOf, type RunState } from './sequence-model';
import { SequenceDoneBody, SequenceHeader, SequenceIntroBody, SequenceStepBody } from './SequenceResolver.parts';
import { SEQUENCE_METRICS } from './SequenceResolver.metrics';
import { columnSx, sheetPaperSx } from './SequenceResolver.styles';
import type { SequenceItem, SequenceResolverProps, SequenceStepApi } from './SequenceResolver.types';
import { useSequenceRun, type SequenceRun } from './useSequenceRun';

/** What the header's label says on the screen showing. */
function headerLabelOf<I extends SequenceItem, R>(
  props: SequenceResolverProps<I, R>,
  run: RunState<I, R>,
  current: I | undefined,
): string {
  const { labels } = props;
  if (props.intro) return labels.introStep;
  if (!current) return labels.doneStep;
  return labels.step(positionOf(run), summaryOf(run).total, current);
}

/** The header's back button, once a previous step exists and the host allows it. */
function backOf<I extends SequenceItem, R>(props: SequenceResolverProps<I, R>, state: SequenceRun<I, R>) {
  const { intro, labels, canGoBack = true } = props;
  if (intro || !canGoBack || state.run.visits.length === 0) return undefined;
  return { label: labels.back, accessible: labels.backAccessible, onClick: state.back, disabled: state.busy };
}

/**
 * Esc closes. `persistent` turns MUI's own Esc off together with the veil's
 * click (the prototype's veil does nothing), so Esc is put back here; a popup
 * inside a step that handles its own Esc stops it before it gets here.
 */
function escapeCloses(close: () => void) {
  return (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.stopPropagation();
    close();
  };
}

interface BodyProps<I extends SequenceItem, R> {
  props: SequenceResolverProps<I, R>;
  state: SequenceRun<I, R>;
  current: I | undefined;
  api: SequenceStepApi<R>;
  titleId: string;
  stepTitleRef: React.RefObject<HTMLElement | null>;
  touch: boolean;
  testId: string;
  close: () => void;
}

/** The intro, the step on screen, or the end screen. */
function SequenceBody<I extends SequenceItem, R>(body: BodyProps<I, R>): React.JSX.Element {
  const { props, state, current, api, titleId, stepTitleRef, touch, testId, close } = body;
  if (props.intro) {
    return <SequenceIntroBody intro={props.intro} titleId={titleId} testId={testId} screenKey="intro" />;
  }
  if (current) {
    return (
      <SequenceStepBody
        step={props.renderStep(current, api)}
        skip={{ label: props.labels.skip, onClick: state.skip }}
        busy={state.busy}
        error={state.error}
        touch={touch}
        testId={testId}
        screenKey={`step:${current.key}`}
        titleRef={stepTitleRef}
      />
    );
  }
  const summary = summaryOf(state.run);
  return (
    <SequenceDoneBody
      done={typeof props.done === 'function' ? props.done(summary) : props.done}
      titleId={titleId}
      error={state.error}
      touch={touch}
      onConfirm={close}
      testId={testId}
      screenKey="done"
    />
  );
}

/**
 * Resolve a queue of problems one at a time, in ONE dialog whose body is
 * replaced step by step: a header with "‹ Back", the step's label and close,
 * a progress bar, the host's step, and an end screen (FUT-3671).
 *
 * A centred `Dialog` from the `sm` breakpoint up; the `Dialog` inset
 * bottom-sheet variant below it, never taller than 95% of the viewport. Either
 * way the paper scrolls inside the viewport, so a long step is never cut off.
 *
 * The component owns the run — which step is on screen, what was answered or
 * skipped, where Back returns to — and nothing about the domain: every step
 * body, every word and every server call is the host's.
 */
export function SequenceResolver<I extends SequenceItem, R = unknown>(
  props: SequenceResolverProps<I, R>,
): React.JSX.Element {
  const { open, onClose, intro, labels } = props;
  const testId = props.dataTestId ?? 'sequence-resolver';
  const theme = useTheme();
  const touch = useMediaQuery(theme.breakpoints.down(SEQUENCE_METRICS.sheetBreakpoint));
  const titleId = `${useId()}-title`;
  const stepTitleRef = useRef<HTMLElement | null>(null);
  const titleRef = useCallback((node: HTMLElement | null) => {
    stepTitleRef.current = node;
  }, []);

  const state = useSequenceRun<I, R>({
    active: open && !intro,
    queue: props.queue,
    onBack: props.onBack,
    failed: labels.failed,
  });
  const { run, busy } = state;
  const current = intro ? undefined : currentOf(run);
  const close = (): void => onClose(summaryOf(run));
  const api: SequenceStepApi<R> = {
    resolve: state.resolve,
    skip: state.skip,
    back: state.back,
    busy,
    titleProps: { id: titleId, tabIndex: -1, ref: titleRef },
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      persistent
      variant={touch ? 'bottom-sheet' : 'default'}
      size="sm"
      aria-labelledby={titleId}
      onKeyDown={escapeCloses(close)}
      slotProps={{ paper: { sx: touch ? sheetPaperSx() : undefined } }}
      dataTestId={testId}
    >
      <Box sx={columnSx}>
        <SequenceHeader
          touch={touch}
          label={headerLabelOf(props, run, current)}
          back={backOf(props, state)}
          closeLabel={labels.close}
          onClose={close}
          progress={intro ? 0 : progressOf(run)}
          progressLabel={labels.progress}
          testId={testId}
        />
        <SequenceBody
          props={props}
          state={state}
          current={current}
          api={api}
          titleId={titleId}
          stepTitleRef={stepTitleRef}
          touch={touch}
          testId={testId}
          close={close}
        />
      </Box>
    </Dialog>
  );
}
