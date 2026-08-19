import { useCallback, useEffect, useRef, useState } from "react";

import type { EmailAuthClientResult } from "./create-email-auth";
import type { EmailAuthFailure } from "../email-credentials/types";

/**
 * The state every one of these screens needs: submitting, refused, done.
 *
 * Six screens (sign up, verify, resend, forgot, reset, add a password) each
 * wrap one async call and each need the identical four pieces of state around
 * it. Written by hand six times, at least one of them gets the double-submit
 * guard wrong and at least one leaves the spinner up after an error — so it is
 * written once, here.
 *
 * Two behaviours are the reason this is not just `useState`:
 *
 * - **A second submit while the first is in flight is dropped.** Not merely
 *   disabled in the UI: a `disabled` button is a race, since the click can land
 *   in the same tick as the state update. On these endpoints a double submit is
 *   two accounts, or two reset mails.
 * - **A result that arrives after the component unmounted is discarded**, so a
 *   screen that navigates away on success does not then set state on a tree
 *   that is gone.
 */

export interface AuthActionState<T> {
  /** The call is in flight. */
  pending: boolean;
  /** The refusal code from the last attempt, if it failed. */
  reason: EmailAuthFailure | "unknown" | null;
  /** Which password rules were broken, when `reason` is `weak-password`. */
  violations: readonly string[] | null;
  /** The payload of the last successful attempt. */
  data: T | null;
  /** The last attempt succeeded. */
  done: boolean;
}

export interface AuthAction<Input, T> extends AuthActionState<T> {
  /** Run it. Resolves with the result, or `null` if a call was already in flight. */
  run: (input: Input) => Promise<EmailAuthClientResult<T> | null>;
  /** Clear the refusal — for an onChange that dismisses the error as you retype. */
  reset: () => void;
}

const IDLE = {
  pending: false,
  reason: null,
  violations: null,
  data: null,
  done: false,
} as const;

/**
 * Wrap one call from {@link createEmailAuth} as submittable form state.
 *
 * ```tsx
 * const signUp = useAuthAction(emailAuth.signUp);
 * <form onSubmit={(e) => { e.preventDefault(); void signUp.run({ email, password }); }}>
 * ```
 */
export function useAuthAction<Input, T>(
  action: (input: Input) => Promise<EmailAuthClientResult<T>>,
): AuthAction<Input, T> {
  const [state, setState] = useState<AuthActionState<T>>(IDLE);
  // A ref, not the `pending` state: the guard has to be true synchronously
  // within the click that set it, and a state update is not.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (input: Input): Promise<EmailAuthClientResult<T> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setState({ ...IDLE, pending: true });
      try {
        const result = await action(input);
        if (mounted.current) {
          setState(
            result.ok
              ? { pending: false, reason: null, violations: null, data: result.data, done: true }
              : {
                  pending: false,
                  reason: result.reason,
                  violations: result.violations ?? null,
                  data: null,
                  done: false,
                },
          );
        }
        return result;
      } finally {
        inFlight.current = false;
      }
    },
    [action],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, run, reset };
}
