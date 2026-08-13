import { useCallback, useEffect, useState } from 'react';

import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import type { ConsentStatus } from '../../core/consent-wire';
import { joinApiPath } from '../../core/api';

/**
 * Is this user overdue to accept the terms, and can they do it here?
 *
 * Bumping the deployment's terms version makes the host's own "has accepted"
 * predicate false for everyone who accepted the previous one, and every guard reads
 * that predicate — so a signed-in user kept their avatar, their cart and their
 * session while the checkout answered a bare `401 {"error":"Unauthorized"}` with a
 * retry button that could never succeed. The server could already fix them; nothing
 * could TELL them.
 *
 * Correctness lives here, in a plain fetch, on purpose. A realtime event can only
 * make this promptER — a best-effort bus loses events by contract, so a prompt that
 * existed only on the socket would reintroduce exactly this bug for anyone whose
 * connection dropped. See `terms-consent-dialog.tsx` for the accelerator, and note
 * that it is an accelerator.
 */

export interface TermsConsent {
  /** The user must accept the current terms before guarded actions work. */
  stale: boolean;
  /** An acceptance is in flight. */
  accepting: boolean;
  /** Accept the current terms; resolves true once recorded. */
  accept: () => Promise<boolean>;
  /** Re-ask the server — what a realtime "terms changed" hint triggers. */
  refresh: () => Promise<void>;
}

/**
 * The envelope tolerance is deliberate, and it is not laziness.
 *
 * `createApiAppShell` answers `{ data: { stale, version } }` — the envelope every
 * surface in this org uses. A host that mounted the descriptors behind its own
 * handler may well answer the bare object instead, and the whole point of this hook
 * is that it never fails CLOSED into silence: reading both shapes means a host
 * whose envelope differs gets a working prompt rather than a user who is never
 * asked.
 */
function readStale(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as { data?: unknown; stale?: unknown };
  const body = (record.data ?? record) as Partial<ConsentStatus>;
  return body.stale === true;
}

export interface UseTermsConsentOptions {
  /** Where the shell's surface is mounted. Defaults to `/api`. */
  apiBase?: string;
}

export function useTermsConsent(options: UseTermsConsentOptions = {}): TermsConsent {
  const apiBase = options.apiBase ?? '/api';
  const [stale, setStale] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(joinApiPath(apiBase, CONSENT_STATUS_PATH), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      setStale(readStale(await response.json()));
    } catch {
      // Never block the app on this check. A user who IS stale still meets the
      // guard's own error; a user who is not loses nothing.
      setStale(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const accept = useCallback(async () => {
    setAccepting(true);
    try {
      const response = await fetch(joinApiPath(apiBase, CONSENT_ACCEPT_PATH), {
        method: 'POST',
        credentials: 'same-origin',
      });
      // The endpoint PROPAGATES a stamping failure (→ 500) rather than answering
      // 204, precisely so this cannot report success while leaving the user locked
      // out. Trust the status.
      if (!response.ok) return false;
      setStale(false);
      return true;
    } catch {
      return false;
    } finally {
      setAccepting(false);
    }
  }, [apiBase]);

  return { stale, accepting, accept, refresh };
}
