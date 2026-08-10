// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { AUTOSAVE_DELAY_MS, useAutosave } from '../lib/use-autosave';

/**
 * "If I started editing it save a draft version" (FUT-755) — the debounce, and
 * the two things it must never do.
 *
 * Time is FAKED throughout. A debounce tested by waiting is a test that either
 * takes a second and a bit per case or, worse, passes on a fast machine and
 * fails on a loaded CI runner; every case here advances the clock by an exact
 * amount and asserts on what happened at that instant.
 *
 * The case that matters most is the failing save. It is the one most likely to
 * be skipped, and the one where a wrong implementation is invisible: an
 * autosave that reports success it did not have moves the unsaved-changes
 * baseline, disarms the tab-close guard, and the work is gone at exactly the
 * moment the person was relying on it being kept.
 */

interface Props {
  value: { name: string };
  dirty: boolean;
  enabled?: boolean;
}

/**
 * A caller that behaves like the editor: it hands the hook a value and a dirty
 * flag, and it only stops being dirty when a save actually succeeded.
 *
 * Everything the stub records lands on a CONTAINER's properties rather than on
 * rebound closure variables — the form the flakiness gate requires, and the one
 * that cannot silently capture a stale binding.
 */
function harness(options: { succeeds: boolean }): {
  saved: string[];
  outcome: { succeeds: boolean };
  onSave: (value: { name: string }) => Promise<boolean>;
} {
  const saved: string[] = [];
  const outcome = { succeeds: options.succeeds };
  return {
    saved,
    outcome,
    onSave: vi.fn((value: { name: string }) => {
      saved.push(value.name);
      return Promise.resolve(outcome.succeeds);
    }),
  };
}

function mount(
  props: Props,
  onSave: (value: { name: string }) => Promise<boolean>,
): ReturnType<typeof renderHook<string, Props>> {
  return renderHook<string, Props>(
    (current) =>
      useAutosave({
        value: current.value,
        dirty: current.dirty,
        onSave,
        ...(current.enabled === undefined ? {} : { enabled: current.enabled }),
      }),
    { initialProps: props },
  );
}

/** Move the clock, letting the resolved promises inside the timer settle. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useAutosave', () => {
  /**
   * The requirement in one case: a draft is created on the first real EDIT,
   * not on opening the editor. Opening a report to look at it must not stamp it
   * as having unpublished changes.
   */
  it('saves nothing while the editor is clean, however long it sits open', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'Vendas' }, dirty: false }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS * 10);

    expect(stub.saved).toEqual([]);
    expect(view.result.current).toBe('idle');
  });

  it('waits out the debounce before spending a round trip', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS - 1);
    expect(stub.saved).toEqual([]);

    await tick(1);
    expect(stub.saved).toEqual(['V']);
    expect(view.result.current).toBe('saved');
  });

  /**
   * Typing does not queue one request per keystroke: the timer is re-armed and
   * what finally goes to the server is the LATEST value, once.
   */
  it('collapses a burst of edits into a single save of the last value', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS - 200);
    view.rerender({ value: { name: 'Ve' }, dirty: true });
    await tick(AUTOSAVE_DELAY_MS - 200);
    view.rerender({ value: { name: 'Ven' }, dirty: true });
    expect(stub.saved).toEqual([]);

    await tick(AUTOSAVE_DELAY_MS);
    expect(stub.saved).toEqual(['Ven']);
  });

  /**
   * A re-render that changes NOTHING must not push the debounce out. The editor
   * re-renders for reasons that have nothing to do with the draft — a query
   * settling, a panel opening — and a hook keyed on object identity would
   * re-arm on each one and, beside anything that polls, never save at all.
   */
  it('is not re-armed by a re-render that changed nothing', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS - 100);
    // A fresh object with identical contents — what the editor rebuilds every
    // render.
    view.rerender({ value: { name: 'V' }, dirty: true });
    await tick(100);

    expect(stub.saved).toEqual(['V']);
  });

  /**
   * THE case. A save the server rejected must leave the work dirty — the hook
   * reports the failure and never tells the caller to move its baseline, so the
   * tab-close guard stays armed on work that is still only in the browser.
   */
  it('leaves the work dirty and says so when the save fails', async () => {
    const stub = harness({ succeeds: false });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS);

    expect(stub.saved).toEqual(['V']);
    expect(view.result.current).toBe('error');
    // The caller's dirty flag is derived, so the proof that nothing pretended
    // to succeed is that the hook is still being handed `dirty: true` and is
    // content with that — it neither clears the state nor re-fires.
    await tick(AUTOSAVE_DELAY_MS * 5);
    expect(view.result.current).toBe('error');
  });

  it('treats a rejected promise as a failure rather than crashing the editor', async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error('offline')));
    const view = mount({ value: { name: 'V' }, dirty: true }, rejecting);

    await tick(AUTOSAVE_DELAY_MS);

    expect(rejecting).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBe('error');
  });

  /**
   * One attempt per change. A server that is refusing is asked once, not every
   * `delayMs` forever — but the next keystroke is both the retry and the reason
   * to retry.
   */
  it('retries only when there is something new to retry with', async () => {
    const stub = harness({ succeeds: false });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS * 4);
    expect(stub.saved).toEqual(['V']);

    stub.outcome.succeeds = true;
    view.rerender({ value: { name: 'Vendas' }, dirty: true });
    await tick(AUTOSAVE_DELAY_MS);

    expect(stub.saved).toEqual(['V', 'Vendas']);
    expect(view.result.current).toBe('saved');
  });

  /** A manual save in flight turns it off, so the two cannot race. */
  it('stands down while a manual save is running', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'V' }, dirty: true, enabled: false }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS * 3);
    expect(stub.saved).toEqual([]);

    view.rerender({ value: { name: 'V' }, dirty: true, enabled: true });
    await tick(AUTOSAVE_DELAY_MS);
    expect(stub.saved).toEqual(['V']);
  });

  /** A save that lands clears the pending work rather than re-sending it. */
  it('stops once the caller reports the draft clean again', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS);
    view.rerender({ value: { name: 'V' }, dirty: false });
    await tick(AUTOSAVE_DELAY_MS * 5);

    expect(stub.saved).toEqual(['V']);
  });

  /** An editor that has been navigated away from has no timer left behind. */
  it('drops a pending save when the editor unmounts', async () => {
    const stub = harness({ succeeds: true });
    const view = mount({ value: { name: 'V' }, dirty: true }, stub.onSave);

    await tick(AUTOSAVE_DELAY_MS - 50);
    view.unmount();
    await tick(AUTOSAVE_DELAY_MS);

    expect(stub.saved).toEqual([]);
  });
});
