import { useState } from 'react';

import type { RbacResult } from './transport';

/**
 * The state machine behind every confirm-gated destructive write (12-13):
 * a request parks the subject, the confirm step runs the write, and a
 * refusal SURFACES its user-safe error instead of rendering nothing —
 * review-150 MAJOR-5's two obligations, kept in one place so the two screens
 * cannot drift on either.
 */
interface Confirmable<T> {
  /** The subject awaiting confirmation, or null (dialog closed). */
  pending: T | null;
  busy: boolean;
  /** The last refused write's user-safe message, or null. */
  error: string | null;
  request(subject: T): void;
  cancel(): void;
  confirm(): Promise<void>;
}

export function useConfirmable<T>(
  execute: (subject: T) => Promise<RbacResult<unknown>>,
  onDone: () => void,
): Confirmable<T> {
  const [pending, setPending] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    pending,
    busy,
    error,
    request: (subject) => setPending(subject),
    cancel: () => setPending(null),
    async confirm() {
      if (pending === null) return;
      setBusy(true);
      const result = await execute(pending);
      setBusy(false);
      setPending(null);
      setError(result.ok ? null : result.error);
      if (result.ok) onDone();
    },
  };
}
