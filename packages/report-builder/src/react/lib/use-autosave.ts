import { useEffect, useRef, useState } from "react";

import { deepEqual } from "../../dirty-state";

/**
 * Debounced autosave for the report editor (FUT-755) — "if I started editing
 * it, save a draft version".
 *
 * Three properties are the whole design, and each rules out a shorter
 * implementation:
 *
 *  1. **It fires on the first real EDIT, never on opening the editor.** The
 *     trigger is the caller's `dirty` flag, which `dirty-state` derives by
 *     comparing the working copy against the last-saved baseline. So opening a
 *     report to look at it, selecting a block, or dragging one back where it
 *     started all leave `dirty` false and save nothing. A hook that armed a
 *     timer on mount would stamp "unpublished changes" on every report anyone
 *     ever opened.
 *
 *  2. **A failed save leaves the work dirty.** This hook never touches the
 *     baseline; the caller moves it, and only when `onSave` resolves `true`.
 *     That is what keeps the tab-close guard armed after a save that did not
 *     land — the moment it matters most.
 *
 *  3. **One attempt per change.** After a failure the timer is NOT re-armed
 *     for the same value, so a server that is refusing is asked once rather
 *     than every `delayMs` forever. The next keystroke arms it again, which is
 *     both the retry and the signal that there is something new to retry with.
 */

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/** How long the editor sits still before an edit is worth a round trip. */
export const AUTOSAVE_DELAY_MS = 1_200;

export function useAutosave<T>({
  value,
  dirty,
  onSave,
  delayMs = AUTOSAVE_DELAY_MS,
  enabled = true,
}: {
  /** The working copy — only what a save would persist. */
  value: T;
  /** Derived by the caller (see `dirty-state`), never raised by a callback. */
  dirty: boolean;
  /** Resolves `true` when the work is safely stored. Rejections count as false. */
  onSave: (value: T) => Promise<boolean>;
  delayMs?: number;
  /** Off while a manual save is in flight, so the two cannot race. */
  enabled?: boolean;
}): AutosaveState {
  const [state, setState] = useState<AutosaveState>("idle");
  // Read through a ref so re-arming does not depend on the caller memoizing
  // `onSave`; a stale closure here would autosave the draft as it was when the
  // timer was armed, silently discarding everything typed since.
  const latest = useRef({ value, onSave });
  latest.current = { value, onSave };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  /** The exact value the pending timer was armed for; null when disarmed. */
  const armedFor = useRef<{ value: T } | null>(null);

  function disarm(): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    armedFor.current = null;
  }

  async function run(): Promise<void> {
    timer.current = null;
    inFlight.current = true;
    setState("saving");
    const { value: pending, onSave: save } = latest.current;
    const saved = await save(pending).catch(() => false);
    inFlight.current = false;
    setState(saved ? "saved" : "error");
  }

  // Deliberately NO dependency array. `value` is rebuilt on every render (it is
  // an object literal of the editor's state), so a dependency on it would
  // re-arm the debounce on every unrelated re-render and a report left open
  // beside a polling query would never autosave at all. The guard is a
  // STRUCTURAL comparison instead — the same one that decides `dirty`, so the
  // two can never disagree about whether something changed.
  useEffect(() => {
    // A clean editor has nothing pending, and neither has one whose manual save
    // is in flight: a successful save moves the baseline, and a timer left
    // behind would re-send bytes the server already has.
    if (!enabled || !dirty) {
      disarm();
      return;
    }
    if (inFlight.current) return;
    if (armedFor.current !== null && deepEqual(armedFor.current.value, value)) return;
    if (timer.current !== null) clearTimeout(timer.current);
    armedFor.current = { value };
    timer.current = setTimeout(() => void run(), delayMs);
  });

  // Unmount: the editor is gone, so its pending timer must be too.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return state;
}
