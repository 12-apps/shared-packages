'use client';

import { useState } from 'react';

import type { RbacResult } from './transport';
import type { RoleFormValue } from './role-form';

/**
 * A role form's popup state and the ONE write behind it.
 *
 * The catalog composes a role and the row menu edits one, and both are the same
 * four facts — is the dialog open, is a save in flight, what did the last one
 * refuse, and what happens on submit. They were two hooks with two copies of
 * that state machine, differing only in which api call ran; the failure mode is
 * that a fix to one (clearing the error on close, say) reaches the other months
 * later or never.
 *
 * The DIFFERENCE is a function, so that is the parameter.
 */
export interface RoleWrite {
  open: boolean;
  busy: boolean;
  /** The last refusal's user-safe sentence, or null. */
  error: string | null;
  start: () => void;
  close: () => void;
  submit: (value: RoleFormValue) => Promise<void>;
}

/**
 * @param write The save. Returns an {@link RbacResult} rather than throwing —
 * a refused write is an answer, not an exception, and the form has to render
 * its sentence.
 * @param onSaved Re-read the catalog. Called only after a write that landed.
 */
export function useRoleWrite(
  write: (value: RoleFormValue) => Promise<RbacResult<unknown>>,
  onSaved: () => void,
): RoleWrite {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    open,
    busy,
    error,
    start: () => setOpen(true),
    close: () => {
      setOpen(false);
      // Cleared on CLOSE rather than on open: a stale refusal rendering for one
      // frame the next time the dialog opens is the artefact this avoids.
      setError(null);
    },
    async submit(value) {
      setBusy(true);
      setError(null);
      const result = await write(value);
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onSaved();
    },
  };
}
