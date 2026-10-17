import { useCallback, useRef, useState } from 'react';

import {
  backRun,
  currentOf,
  pinRun,
  previousOf,
  resolveRun,
  skipRun,
  startRun,
  syncRun,
  type RunState,
} from './sequence-model';
import type { SequenceItem } from './SequenceResolver.types';

interface RunInputs<I extends SequenceItem, R> {
  /** True while the run is on screen: open, and past the intro. */
  active: boolean;
  queue: readonly I[];
  onBack?: (item: I, result: R) => Promise<void> | void;
  /** The message for a rejection that carries none. */
  failed: string;
}

export interface SequenceRun<I extends SequenceItem, R> {
  run: RunState<I, R>;
  busy: boolean;
  error: string | null;
  resolve: (result: R | PromiseLike<R>) => void;
  skip: () => void;
  back: () => void;
}

interface Tracked<I extends SequenceItem, R> {
  run: RunState<I, R>;
  /** The queue `run` was last reconciled with, by reference. */
  queue: readonly I[];
  active: boolean;
}

function isThenable<R>(value: R | PromiseLike<R>): value is PromiseLike<R> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

function messageOf(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason) return reason;
  return fallback;
}

interface AsyncGate {
  busy: boolean;
  error: string | null;
  /** True from the moment work starts — read before React re-renders with `busy`. */
  isPending: () => boolean;
  clearError: () => void;
  /** Run `work`; on success apply `onDone`, on failure keep the screen and show why. */
  settle: <T>(work: PromiseLike<T>, onDone: (value: T) => void) => void;
  /** Forget pending work (a restart): whatever settles later touches nothing. */
  reset: () => void;
}

/**
 * `busy` while a promise settles, the rejection's message as `error`, and
 * nothing double-fired. Refs, not state, for the guard: a second tap in the
 * same frame reads them before React has re-rendered with `busy`, and a
 * promise settling after a restart must not touch the new run.
 */
function useAsyncGate(failed: string): AsyncGate {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);

  const settle = useCallback(
    <T,>(work: PromiseLike<T>, onDone: (value: T) => void) => {
      const mine = generation.current;
      pending.current = true;
      setBusy(true);
      setError(null);
      const finish = (): boolean => {
        if (mine !== generation.current) return false;
        pending.current = false;
        setBusy(false);
        return true;
      };
      work.then(
        (value) => {
          if (finish()) onDone(value);
        },
        (reason: unknown) => {
          if (finish()) setError(messageOf(reason, failed));
        },
      );
    },
    [failed],
  );

  const reset = (): void => {
    generation.current += 1;
    pending.current = false;
    if (busy) setBusy(false);
    if (error) setError(null);
  };

  return {
    busy,
    error,
    isPending: () => pending.current,
    clearError: () => setError(null),
    settle,
    reset,
  };
}

/**
 * The run, restarted from the queue each time it becomes ACTIVE (the resolver
 * opens past its intro, or the intro is dropped). While active, each new queue
 * is reconciled into it during render (`syncRun`) rather than in an effect, so
 * no frame ever shows a step the queue has already dropped.
 */
function useTrackedRun<I extends SequenceItem, R>(
  active: boolean,
  queue: readonly I[],
  onRestart: () => void,
): { run: RunState<I, R>; update: (step: (run: RunState<I, R>) => RunState<I, R>) => void } {
  const [tracked, setTracked] = useState<Tracked<I, R>>(() => ({ run: startRun(queue), queue, active }));
  let current = tracked;
  if (active !== tracked.active || queue !== tracked.queue) {
    const restart = active && !tracked.active;
    current = { run: restart ? startRun(queue) : syncRun(tracked.run, queue), queue, active };
    if (restart) onRestart();
    setTracked(current);
  }
  const update = useCallback((step: (run: RunState<I, R>) => RunState<I, R>) => {
    setTracked((prev) => ({ ...prev, run: step(prev.run) }));
  }, []);
  return { run: current.run, update };
}

/** The run's state and its verbs — the index/back/skip/done logic, once (FUT-3671). */
export function useSequenceRun<I extends SequenceItem, R>(inputs: RunInputs<I, R>): SequenceRun<I, R> {
  const { active, queue, onBack, failed } = inputs;
  const gate = useAsyncGate(failed);
  const { run, update } = useTrackedRun<I, R>(active, queue, gate.reset);
  const { settle, isPending, clearError } = gate;

  const onScreen = currentOf(run);
  const resolve = (result: R | PromiseLike<R>): void => {
    if (isPending() || !onScreen) return;
    if (isThenable(result)) {
      // The host's refetch may drop the entry before its write returns: keep
      // it on screen meanwhile, and answer THIS entry when it does.
      update((prev) => pinRun(prev, onScreen.key));
      settle(result, (value) => update((prev) => resolveRun(prev, value, onScreen)));
      return;
    }
    clearError();
    update((prev) => resolveRun(prev, result, onScreen));
  };

  const skip = (): void => {
    if (isPending() || !onScreen) return;
    clearError();
    update((prev) => skipRun(prev, onScreen.key));
  };

  const back = (): void => {
    const last = previousOf(run);
    if (isPending() || !last) return;
    if (last.outcome === 'resolved' && onBack) {
      // `new Promise` so a handler that throws synchronously lands in the same
      // rejection path as one that rejects.
      const undo = new Promise<void>((done) => done(onBack(last.item, last.result)));
      settle(undo, () => update(backRun));
      return;
    }
    clearError();
    update(backRun);
  };

  return { run, busy: gate.busy, error: gate.error, resolve, skip, back };
}
