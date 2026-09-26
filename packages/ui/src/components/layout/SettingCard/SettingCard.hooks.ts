import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { focusFirstTabbable } from '../../feedback/Dialog/Dialog.focus';

import type { SettingCardProps, SettingErrorFormatter, SettingSaveResult } from './SettingCard.types';

/** The sentence a rejected save shows: the host's, else the copy's fallback. */
export function saveErrorMessage(
  error: unknown,
  formatError: SettingErrorFormatter | undefined,
  fallback: string,
): string {
  return formatError?.(error) ?? fallback;
}

/**
 * Open state that is controlled when `open` is passed and uncontrolled
 * otherwise — the shape MUI's own `useControlled` has, without its dev-only
 * warnings reaching into this package's surface.
 */
export function useControllableOpen(
  open: boolean | undefined,
  defaultOpen: boolean,
  onOpenChange: ((open: boolean) => void) | undefined,
): [boolean, (next: boolean) => void] {
  const [inner, setInner] = useState(defaultOpen);
  const controlled = open !== undefined;
  const value = controlled ? open : inner;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  return [value, setOpen];
}

/**
 * Runs a save that may or may not be async and reports how it went.
 *
 * `Promise.resolve().then(save)` rather than `await save()`: it also catches a
 * handler that throws SYNCHRONOUSLY, which an `await` inside `try` would too —
 * but it keeps the pending state visible for one tick even when the handler
 * returns nothing, so a save never "succeeds" in the middle of the click that
 * started it. A sequence id drops the outcome of a run the card has since
 * abandoned (closed, or started again).
 */
export function useSaveRunner(formatError: SettingErrorFormatter | undefined, fallback: string) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      // Unmounted: whatever is still in flight has nobody left to report to.
      seq.current += 1;
    },
    [],
  );

  const run = useCallback(
    async (save: () => SettingSaveResult): Promise<boolean> => {
      const mine = (seq.current += 1);
      setSaving(true);
      setError(null);
      try {
        await Promise.resolve().then(save);
        if (seq.current !== mine) return false;
        setSaving(false);
        return true;
      } catch (cause) {
        if (seq.current !== mine) return false;
        setSaving(false);
        setError(saveErrorMessage(cause, formatError, fallback));
        return false;
      }
    },
    [formatError, fallback],
  );

  const reset = useCallback(() => {
    seq.current += 1;
    setSaving(false);
    setError(null);
  }, []);

  return { saving, error, run, reset };
}

/**
 * A switch that saves the moment it flips.
 *
 * It shows the flip at once (`pending`) and holds it while the save runs; a
 * success hands back to the host's `checked`, which by then says the same
 * thing, and a failure drops `pending` so the switch returns to what is
 * actually saved. A flip while one is in flight is ignored rather than queued:
 * two racing writes of a boolean have no right answer.
 */
export function useAsyncSwitch(options: {
  checked: boolean;
  onChange: (checked: boolean) => SettingSaveResult;
  formatError: SettingErrorFormatter | undefined;
  fallback: string;
}) {
  const { checked, onChange, formatError, fallback } = options;
  const [pending, setPending] = useState<boolean | null>(null);
  const { saving, error, run } = useSaveRunner(formatError, fallback);

  const flip = useCallback(
    async (next: boolean) => {
      if (saving) return;
      setPending(next);
      await run(() => onChange(next));
      setPending(null);
    },
    [saving, run, onChange],
  );

  return { shown: pending ?? checked, saving, error, flip };
}

/**
 * Focus follows the card: into it when it opens, back to the trigger when it
 * closes.
 *
 * Inward, it is the Dialog's own rule (`focusFirstTabbable`, FUT-2696): the
 * first tabbable descendant, and a caller's `autoFocus` keeps winning. The
 * card is NOT a trap — it is inline, the rest of the page is still there, and
 * locking Tab inside it would strand a keyboard user who wants to leave
 * mid-edit. What it owes them is the round trip: the Edit trigger unmounts
 * while the card is open, so without the return focus would fall to <body>
 * and the reader would start again from the top of the page.
 *
 * Only a TRANSITION moves focus: a card mounted open (or closed) leaves focus
 * where the page put it.
 */
export function useFocusHandoff(
  open: boolean,
  body: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
): void {
  const previous = useRef(open);

  useLayoutEffect(() => {
    if (previous.current === open) return;
    previous.current = open;
    if (open && body.current) focusFirstTabbable(body.current);
    if (!open) trigger.current?.focus();
  }, [open, body, trigger]);
}

/**
 * Everything an editable card DOES, apart from how it looks: its open state,
 * the save and its outcome, Cancel, and where focus goes.
 */
export function useSettingCard(props: SettingCardProps) {
  const { copy, onSave, onCancel, open: openProp, defaultOpen = false, onOpenChange, formatError } = props;
  const disabled = props.disabled ?? false;
  const saveDisabled = props.saveDisabled ?? false;
  const [open, setOpen] = useControllableOpen(openProp, defaultOpen, onOpenChange);
  const { saving, error, run, reset } = useSaveRunner(formatError, copy.saveFailed);
  const bodyRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  useFocusHandoff(open, bodyRef, editRef);

  // However the card closed — Cancel, a save, or a controlling host — the
  // next opening starts without the last one's error.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const openCard = useCallback(() => setOpen(true), [setOpen]);

  const cancel = useCallback(() => {
    if (saving) return;
    setOpen(false);
    onCancel?.();
  }, [saving, setOpen, onCancel]);

  const save = useCallback(() => {
    if (saving || saveDisabled) return;
    void run(onSave).then((saved) => {
      if (saved) setOpen(false);
    });
  }, [saving, saveDisabled, run, onSave, setOpen]);

  return { open, disabled, saveDisabled, saving, error, bodyRef, editRef, openCard, cancel, save };
}
