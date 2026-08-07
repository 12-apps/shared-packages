import { useEffect, useRef, useState } from "react";

import { isDirty } from "../../dirty-state";

/**
 * Unsaved-changes state for the report editor (FUT-391): a dirty flag derived
 * from the draft, ⌘S / Ctrl+S to save, and a guard against closing the tab on
 * unsaved work.
 *
 * The flag is DERIVED, never raised by an edit callback — see `dirty-state` for
 * why. The baseline moves only on a successful save, so a failed save leaves
 * the report dirty and the guard armed, which is when it matters most.
 */
export function useUnsavedChanges<T>({
  current,
  onSave,
  enabled = true,
}: {
  /** The working copy — only what a save would persist. */
  current: T;
  /** Invoked by ⌘S. Rejecting leaves the baseline untouched. */
  onSave: () => void | Promise<void>;
  /** Off while a save is in flight, so ⌘S cannot queue a second one. */
  enabled?: boolean;
}): { dirty: boolean; markSaved: (saved: T) => void } {
  const [baseline, setBaseline] = useState<T>(current);
  const dirty = isDirty(baseline, current);

  // The listeners are registered once and read through refs. Re-registering on
  // every keystroke would be correct but wasteful, and a stale closure over
  // `current` would save the draft as it was when the listener was attached —
  // silently discarding everything typed since.
  const latest = useRef({ dirty, onSave, enabled });
  latest.current = { dirty, onSave, enabled };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // metaKey for macOS, ctrlKey elsewhere. Checking both means ⌘S works on
      // a Mac and Ctrl+S on Linux/Windows without sniffing the platform.
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
      const { dirty: isDirtyNow, onSave: save, enabled: on } = latest.current;
      if (!on || !isDirtyNow) return;
      // Only prevent the browser's Save Page once we know we are handling it —
      // swallowing ⌘S on a clean report would break a shortcut the person
      // might genuinely have meant for the browser.
      event.preventDefault();
      void save();
    }

    function onBeforeUnload(event: BeforeUnloadEvent): void {
      if (!latest.current.dirty) return;
      // The only cross-browser way to ask for the confirmation dialog. The
      // message itself is ignored by every current browser — they show their
      // own text — so there is nothing to translate here.
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return { dirty, markSaved: setBaseline };
}
