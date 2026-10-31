'use client';

import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Dialog } from '../Dialog';
import { canReturn, currentOf, jumpTargetOf, positionOf, progressOf, summaryOf, type RunState } from './sequence-model';
import {
  SequenceDoneBody,
  SequenceIntroBody,
  SequenceStepBody,
} from './SequenceResolver.parts';
import { SequenceHeader } from './SequenceResolver.header';
import { SequenceOverviewBody } from './SequenceResolver.overview';
import { SEQUENCE_METRICS } from './SequenceResolver.metrics';
import { chromeSx, columnSx, paperSx, scrollBodySx } from './SequenceResolver.styles';
import type {
  SequenceItem,
  SequenceOverviewCategory,
  SequenceResolverProps,
  SequenceStep,
  SequenceStepApi,
} from './SequenceResolver.types';
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
  if (intro || !canGoBack || !canReturn(state.run)) return undefined;
  return { label: labels.back, accessible: labels.backAccessible, onClick: state.back, disabled: state.busy };
}

interface OverviewState {
  /** The overview is on screen instead of the step. */
  shown: boolean;
  /** The header's "Ver todos (N)", while there is a step and more than one problem. */
  button?: { label: string; onClick: () => void; disabled: boolean };
  canPick: (category: SequenceOverviewCategory) => boolean;
  pick: (category: SequenceOverviewCategory) => void;
  hide: () => void;
  /** The overview's title (in the header row): focus goes to it when it opens. */
  titleRef: React.RefObject<HTMLHeadingElement | null>;
}

/**
 * "Ver todos" inside the run: whether it shows, its header button, and its
 * picks. Opening it changes nothing in the run; a pick jumps; "continue"
 * returns to the step it left. Every opening of the resolver starts closed.
 */
function useOverview<I extends SequenceItem, R>(
  props: SequenceResolverProps<I, R>,
  state: SequenceRun<I, R>,
  current: I | undefined,
  open: boolean,
): OverviewState {
  const [shown, setShown] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (shown) setShown(false);
  }
  const { overview } = props;
  const total = summaryOf(state.run).total;
  const available = Boolean(overview && current && total > 1);
  const hide = (): void => setShown(false);
  return {
    shown: shown && available,
    button:
      available && overview
        ? { label: overview.label(total), onClick: () => setShown(true), disabled: state.busy }
        : undefined,
    canPick: (category) => jumpTargetOf(state.run, category.keys) !== undefined,
    pick: (category) => {
      const target = jumpTargetOf(state.run, category.keys);
      if (target === undefined) return;
      state.jumpTo(target);
      setShown(false);
      category.onPick?.();
    },
    hide,
    titleRef,
  };
}

/** What the host's `renderStep` gets: the run's verbs, `busy`, and the props for its title. */
function stepApiOf<I extends SequenceItem, R>(
  state: SequenceRun<I, R>,
  titleProps: SequenceStepApi<R>['titleProps'],
): SequenceStepApi<R> {
  return { resolve: state.resolve, skip: state.skip, back: state.back, jumpTo: state.jumpTo, busy: state.busy, titleProps };
}

interface HeaderInputs<I extends SequenceItem, R> {
  props: SequenceResolverProps<I, R>;
  state: SequenceRun<I, R>;
  current: I | undefined;
  overview: OverviewState;
  titleId: string;
}

/** The header's back, "Ver todos" and label — or, over the overview, its title and close alone. */
function headerOf<I extends SequenceItem, R>(inputs: HeaderInputs<I, R>) {
  const { props, state, current, overview, titleId } = inputs;
  const run = state.run;
  const base = { label: headerLabelOf(props, run, current), progress: props.intro ? 0 : progressOf(run) };
  if (overview.shown && props.overview) {
    return { ...base, title: { id: titleId, text: props.overview.title, ref: overview.titleRef } };
  }
  return { ...base, back: backOf(props, state), seeAll: overview.button };
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
  /** The step on screen, rendered once by the resolver (it also reads `canGoBack` from it). */
  step: SequenceStep | undefined;
  overview: OverviewState;
  titleId: string;
  stepTitleRef: React.RefObject<HTMLElement | null>;
  touch: boolean;
  testId: string;
  close: () => void;
}

/** The intro, the step on screen, or the end screen. */
function SequenceBody<I extends SequenceItem, R>(body: BodyProps<I, R>): React.JSX.Element {
  const { props, state, current, step, overview, titleId, stepTitleRef, touch, testId, close } = body;
  if (props.intro) {
    return <SequenceIntroBody intro={props.intro} titleId={titleId} testId={testId} screenKey="intro" />;
  }
  const stepBody =
    current && step ? (
      <SequenceStepBody
        key={`step:${current.key}`}
        step={step}
        skip={{ label: props.labels.skip, onClick: state.skip }}
        busy={state.busy}
        error={state.error}
        touch={touch}
        testId={testId}
        screenKey={`step:${current.key}`}
        titleRef={stepTitleRef}
        hidden={overview.shown}
      />
    ) : null;
  if (overview.shown && props.overview) {
    // The step stays mounted under the overview, so a half-filled answer survives "continue".
    return (
      <>
        <SequenceOverviewBody
          key="overview"
          categories={props.overview.categories}
          canPick={overview.canPick}
          onPick={overview.pick}
          pickLabel={props.overview.pickLabel}
          continueLabel={props.overview.continueLabel}
          onContinue={overview.hide}
          titleRef={overview.titleRef}
          touch={touch}
          testId={testId}
        />
        {stepBody}
      </>
    );
  }
  if (stepBody) return <>{stepBody}</>;
  // `done: null`: no end screen — the resolver is closing over its last step (see `useExitScreen`).
  if (props.done === null) return <></>;
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
 * With `done: null`, the run's end closes the resolver: `onClose(summary)`
 * once, when the queue runs out while it is open and past the intro. Returns
 * whether the run has ended that way, so the dialog starts closing in the same
 * render (and keeps its last screen for the exit, see `useExitScreen`).
 *
 * `fired` makes it once per ending: StrictMode replays a mount's effects, and
 * a resolver mounted open over an empty queue would otherwise close twice. It
 * resets when the run is live again (a reopening, a queue that grew back).
 */
function useCloseAtEnd(ended: boolean, close: () => void): boolean {
  const closeRef = useRef(close);
  const fired = useRef(false);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!ended) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    closeRef.current();
  }, [ended]);
  return ended;
}

interface Screen {
  header: ReturnType<typeof headerOf>;
  body: React.JSX.Element;
}

/**
 * What the dialog shows. While a step is on screen, that screen — and it is
 * kept: when the run ends with `done: null` the dialog closes in that same
 * render, and its exit transition (a fade, the sheet sliding down) plays over
 * the LAST step as it was — its label, Back, progress and body — rather than
 * an empty, collapsed "done" paper — also once the host turns `open` off from
 * `onClose`. Back is inert during the exit.
 */
function useExitScreen(live: Screen, input: { open: boolean; hasStep: boolean; closesAtEnd: boolean }): Screen {
  const { open, hasStep, closesAtEnd } = input;
  const last = useRef<Screen | null>(null);
  const wasOpen = useRef(open);
  // A new opening is a new run: the last one's screen is not kept into it.
  if (open && !wasOpen.current) last.current = null;
  wasOpen.current = open;
  if (!closesAtEnd) return live;
  if (open && hasStep) {
    last.current = live;
    return live;
  }
  // Ended (or closed by the host after `onClose`): the exit plays over the last step.
  const kept = last.current;
  if (!kept) return live;
  const { header } = kept;
  if (!('back' in header) || !header.back) return kept;
  return { ...kept, header: { ...header, back: { ...header.back, onClick: () => undefined } } };
}

/**
 * Resolve a queue of problems one at a time, in ONE dialog whose body is
 * replaced step by step: a header with "‹ Back", the step's label and close,
 * a progress bar, the host's step, and an end screen (FUT-3671) — or none,
 * with `done: null`: the run's end closes it (FUT-3833).
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

  // Read when an answer is recorded: the step on screen's own `canGoBack`.
  const stepAllowsBack = useRef(true);
  const state = useSequenceRun<I, R>({
    open,
    active: open && !intro,
    queue: props.queue,
    initialKey: props.initialKey,
    onBack: props.onBack,
    failed: labels.failed,
    stepAllowsBack: () => stepAllowsBack.current,
  });
  const { run } = state;
  const current = intro ? undefined : currentOf(run);
  const close = (): void => onClose(summaryOf(run));
  const ended = useCloseAtEnd(open && !intro && !current && props.done === null, close);
  const overview = useOverview(props, state, current, open);
  // Under the overview the step is kept but hidden, and the overview's title names the dialog.
  const titleProps = { id: overview.shown ? `${titleId}-kept` : titleId, tabIndex: -1, ref: titleRef } as const;
  const step = current ? props.renderStep(current, stepApiOf(state, titleProps)) : undefined;
  stepAllowsBack.current = step?.canGoBack !== false;
  const screen = useExitScreen(
    {
      header: headerOf({ props, state, current, overview, titleId }),
      body: (
        <SequenceBody
          props={props}
          state={state}
          current={current}
          step={step}
          overview={overview}
          titleId={titleId}
          stepTitleRef={stepTitleRef}
          touch={touch}
          testId={testId}
          close={close}
        />
      ),
    },
    { open, hasStep: current !== undefined && step !== undefined, closesAtEnd: props.done === null && !intro },
  );

  // The kept screen is a picture of the last step, not a live one: nothing on it acts during the exit.
  const exiting = ended || (!open && props.done === null && !intro);
  const swallow = exiting
    ? (event: React.SyntheticEvent): void => {
        event.preventDefault();
        event.stopPropagation();
      }
    : undefined;

  return (
    <Dialog
      open={open && !ended}
      onClose={close}
      persistent
      variant={touch ? 'bottom-sheet' : 'default'}
      size="sm"
      aria-labelledby={titleId}
      onKeyDown={escapeCloses(close)}
      slotProps={{ paper: { sx: paperSx(touch) } }}
      dataTestId={testId}
    >
      <Box sx={columnSx} inert={exiting} aria-hidden={exiting || undefined} onClickCapture={swallow}>
        <Box sx={chromeSx}>
          <SequenceHeader
            touch={touch}
            {...screen.header}
            closeLabel={labels.close}
            onClose={close}
            progressLabel={labels.progress}
            testId={testId}
          />
        </Box>
        <Box sx={scrollBodySx} data-testid={`${testId}-body`}>
          {screen.body}
        </Box>
      </Box>
    </Dialog>
  );
}
