import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConfirmHandler, UseConfirmActionResult } from './ConfirmAction.types';

/** Used when the guarded action rejects and the caller supplied no wording. */
export const DEFAULT_ERROR_TEXT = 'Não foi possível concluir a ação. Tente novamente.';

/**
 * What the popup says after a failed attempt.
 *
 * A rejection carrying a message wins: the server's sentence ("esta categoria
 * ainda tem produtos vinculados") is the one the operator can act on, and it is
 * strictly better than the generic fallback. Handlers that have nothing useful
 * to say reject with nothing and get `errorText`.
 */
function failureMessage(cause: unknown, errorText: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return errorText;
}

/**
 * The confirmation state machine, headless.
 *
 * It is the whole safety contract in one place, so every consumer gets the same
 * behaviour: the action runs ONLY from `confirm`, never from opening the popup;
 * a second confirm while the first is in flight is dropped (a double-click
 * cannot send two deletes); a rejection keeps the popup open carrying the
 * failure instead of closing over a write that never happened.
 */
export function useConfirmAction(
  onConfirm: ConfirmHandler,
  errorText: string = DEFAULT_ERROR_TEXT,
): UseConfirmActionResult {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `pending` is mirrored in a ref because the two guards that matter — drop a
  // second confirm, ignore a cancel mid-flight — are read inside callbacks that
  // must not be rebuilt on every state change. Reading the state variable there
  // would leave a stale closure holding `false` for the whole in-flight window,
  // which is exactly the double-submit this component exists to prevent.
  const busy = useRef(false);

  // The action can settle after the trigger has unmounted (a row deleted from
  // under its own menu), so the settle path must not touch state by then.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = useCallback((): void => {
    setError(null);
    setOpen(true);
  }, []);

  const cancel = useCallback((): void => {
    // Inert mid-flight: the write has already left, and closing here would hide
    // its outcome.
    if (busy.current) return;
    setOpen(false);
    setError(null);
  }, []);

  const settle = useCallback((failure: string | null): void => {
    busy.current = false;
    if (!mounted.current) return;
    setPending(false);
    setError(failure);
    if (!failure) setOpen(false);
  }, []);

  const confirm = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    // The handler is invoked synchronously, exactly as a plain `onClick` would
    // be — only the OUTCOME is awaited. The try/catch is what puts a handler
    // that throws synchronously on the same failure path as one that returns a
    // rejected promise.
    try {
      const result = onConfirm();
      void Promise.resolve(result)
        .then(() => settle(null))
        .catch((cause: unknown) => settle(failureMessage(cause, errorText)));
    } catch (cause) {
      settle(failureMessage(cause, errorText));
    }
  }, [errorText, onConfirm, settle]);

  return { open, pending, error, request, cancel, confirm };
}
