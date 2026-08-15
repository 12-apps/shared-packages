import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ImpersonationBannerState,
  ImpersonationKind,
  ImpersonationTenant,
  ImpersonationUser,
} from '../core/types';

import type { ImpersonationTransport } from './transport';
import { subscribeToWake } from './wake';

/**
 * The banner's view of the live session, read from the ONE endpoint every app
 * shares.
 *
 * WHY A PLAIN READ AND NOT THE HOST'S QUERY CACHE. Exiting an impersonation
 * CLEARS that cache — the identity behind every cached response just changed. A
 * banner whose own state lived in it would be clearing the ground it stands on,
 * mid-exit, and would race its own unmount. Keeping it outside is what makes the
 * exit a single ordered operation, and it is why this package needs no data
 * -fetching peer at all.
 *
 * The endpoint is deliberately open to anyone: it answers only from the caller's
 * own cookie, and a storefront mounts this for anonymous visitors too.
 * `{ active: false }` is the ordinary answer.
 */

/** Where the state is read from, and how. */
interface ImpersonationStateSource {
  transport: ImpersonationTransport;
  /** The path the platform surface is mounted at. */
  platformPath: string;
}

/** What {@link useImpersonationState} hands the banner. */
export interface ImpersonationStateHandle {
  /** The live session, or null when the caller is acting as themselves. */
  state: ImpersonationBannerState | null;
  /**
   * True when a session IS held but the most recent read did not come back. See
   * {@link useImpersonationState} for why this is surfaced rather than collapsed
   * into `state: null`.
   */
  unconfirmed: boolean;
  /** Re-ask the server. Never throws. */
  refresh: () => Promise<void>;
}

/**
 * Everything in this document that wants to know the moment a session starts or
 * ends — the banner itself, and the start handshake's paint check.
 *
 * A module-level channel rather than context: the thing that STARTS a session is
 * a page, the thing that RENDERS it is app chrome, and requiring a shared
 * provider between them would make the safety property depend on where somebody
 * mounted a component.
 */
const listeners = new Set<() => void>();

function subscribeToImpersonationChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tell every mounted banner to re-read the session. */
export function notifyImpersonationChanged(): void {
  for (const listener of [...listeners]) listener();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

/** One field of the wire payload, read defensively. */
function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseSubject(value: unknown): ImpersonationUser | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, 'id');
  const email = readString(record, 'email');
  if (!id || !email) return null;
  return { id, email, name: readString(record, 'name') };
}

function parseTenant(value: unknown): ImpersonationTenant | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, 'id');
  const slug = readString(record, 'slug');
  const name = readString(record, 'name');
  if (!id || !slug || !name) return null;
  return { id, slug, name };
}

function parseKind(value: string | null): ImpersonationKind | null {
  return value === 'operator' || value === 'preview' ? value : null;
}

/**
 * Normalize `{ data: ImpersonationBannerState }` into a session, or null.
 *
 * Anything the route could not answer fully — no `expiresAt`, an unrecognised
 * `kind` — reads as NO session rather than a half-drawn bar. A banner that
 * cannot state the time box is a banner that cannot do its job, and the caller
 * treats null as "act as yourself", which is the safe direction.
 */
function parseImpersonationState(
  payload: unknown,
): ImpersonationBannerState | null {
  const data = asRecord(asRecord(payload)?.data);
  if (!data || data.active !== true) return null;
  const kind = parseKind(readString(data, 'kind'));
  const expiresAt = readString(data, 'expiresAt');
  if (!kind || !expiresAt) return null;
  return {
    active: true,
    kind,
    expiresAt,
    // Absent reads as read-only: the restrictive answer is the one that is safe
    // to be wrong about.
    readOnly: data.readOnly !== false,
    previewRoleName: readString(data, 'previewRoleName'),
    subject: parseSubject(data.subject),
    tenant: parseTenant(data.tenant),
  };
}

/**
 * The live impersonation session for this document.
 *
 * A FAILED READ NEVER CLEARS A KNOWN SESSION. This is the whole reason the hook
 * carries `unconfirmed` instead of just `state`. The banner is a safety control:
 * if a dropped connection could make it vanish, then the one moment it is most
 * likely to vanish — a flaky network, a backgrounded tab coming back — is a
 * moment somebody is acting as another person with no sign of it on screen. So a
 * refusal to answer downgrades the bar to "could not confirm" and leaves it
 * standing; only a SUCCESSFUL read saying `active: false` takes it down.
 *
 * Re-reads on mount, on every start/stop notification, and whenever the tab
 * wakes.
 */
export function useImpersonationState(
  source: ImpersonationStateSource,
): ImpersonationStateHandle {
  const [state, setState] = useState<ImpersonationBannerState | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  // Read inside `refresh` without making the callback depend on the value, so
  // the subscriptions below are wired once instead of on every state change.
  const held = useRef<ImpersonationBannerState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = parseImpersonationState(
        await source.transport.request(source.platformPath),
      );
      held.current = next;
      setState(next);
      setUnconfirmed(false);
    } catch {
      setUnconfirmed(held.current !== null);
    }
  }, [source]);

  useEffect(() => {
    void refresh();
    const stopListening = subscribeToImpersonationChanges(() => void refresh());
    const stopWaking = subscribeToWake(() => void refresh());
    return () => {
      stopListening();
      stopWaking();
    };
  }, [refresh]);

  return { state, unconfirmed, refresh };
}
