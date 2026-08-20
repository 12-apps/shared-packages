'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

import type { RedirectActivationCopy } from './copy';
import { mintCharge } from './mint-charge';
import {
  postActivation,
  settleActivationPoll,
  type ActivationClock,
  type ActivationPendingBody,
  type ActivationPollBody,
  type RedirectActivationState,
} from './redirect-state';
import { clearReturnedSettlement, takeReturnedSettlement } from './returned-settlement';

/**
 * The activation step for a provider whose payer pays on ITS page (FUT-463,
 * moved here by FUT-763).
 *
 * Same proof as a card form, different protocol: a REAL link is minted through
 * this store's own connection, the owner pays it on the provider's site, and
 * the provider is then ASKED whether it arrived. Only that answer activates the
 * store. The alternative — telling an owner to "make a real low-value order and
 * confirm the money arrives" — is the dead-end instruction the step exists to
 * abolish.
 *
 * ## What is the package's here, and what is not
 *
 * `renderVerification` on `PaymentProviderSettings` says the package decides
 * only WHERE the step appears, never how it works. That still holds for the
 * SCREEN: the panels, the states an owner reads, the sentences — all of that is
 * the host's, and none of it is here.
 *
 * What is here is the PROTOCOL, which is not a matter of taste and is not
 * something a second host should get to rediscover: pick the outstanding charge
 * back up on mount, ask with the return trip's ids on every tick, keep a
 * refused ATTEMPT distinct from an expired charge, keep an unreachable provider
 * distinct from a refusing one, stop asking eventually. Every one of those was
 * learned from a payment that went wrong, and three of them cost a real charge.
 *
 * ## Why the attempt is the SERVER's
 *
 * It used to live in React state, and that was wrong in a way that costs money.
 * The flow deliberately sends the owner to another site to pay, so "left this
 * page and came back" is the NORMAL path, not an edge case — and it erased the
 * attempt every time. The screen then offered to generate a charge, because as
 * far as it knew none existed: a second real charge on the owner's own card,
 * while the first, already paid, was never asked about again.
 *
 * So the outstanding charge is loaded from the server on mount, and the only
 * things that clear it are settlement and an explicit "give up".
 */

/** How often to ask the provider whether the payment landed. */
const DEFAULT_POLL_MS = 4000;

/** Give up asking after this long, rather than polling a tab forever. */
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface RedirectActivationOptions {
  /**
   * The host's verify-charge endpoint for this provider.
   *
   * A whole URL, not the parts of one: the route shape belongs to the host and
   * the package has no business assembling it. `GET` answers the outstanding
   * charge; `POST` takes `{ action: 'start' | 'poll' | 'discard' }`.
   */
  verifyChargeUrl: string;
  /** A passing charge — the caller refreshes so the provider shows as active. */
  onVerified: () => void;
  /**
   * The provider would not mint a link. Called instead of, not as well as,
   * settling anything: no charge exists, so there is nothing to confirm — the
   * caller uses it to reopen the setup step this failure implicates.
   */
  onCreateFailed?: () => void;
  copy: RedirectActivationCopy;
  /** Where the return trip's ids are parked. Defaults per the package. */
  storageKey?: string;
  pollMs?: number;
  pollTimeoutMs?: number;
}

export interface RedirectActivation {
  state: RedirectActivationState;
  /**
   * When the provider last answered, as epoch ms (0 before the first ask).
   *
   * Shown as "last checked Ns ago". A spinner alone says "something is
   * happening"; this says the screen is still asking, which is the reassurance
   * someone who has just paid on another site actually wants — and it is what
   * stops them pressing a pay button again to be sure.
   */
  lastCheckedAt: number;
  /** Mint the link and begin asking. */
  start: () => Promise<void>;
  /** Ask right now, instead of waiting for the next tick. */
  checkNow: () => Promise<void>;
  /** Abandon the outstanding charge and offer a fresh one. */
  reset: () => void;
}

/**
 * What the effects call, read through a ref rather than through their deps.
 *
 * NOT a style preference — it is what makes the hook safe to hand to a host.
 * Every callback here changes identity when the caller re-renders without
 * memoizing, and both effects below would then re-run on it: the resume effect
 * would re-mount the whole sequence (and, since it sets state, re-render, and
 * loop), and the poll timer would be cleared and restarted before it ever
 * ticked — a screen that asks the provider nothing, for ever, while looking
 * exactly like one that is asking.
 *
 * The host that wrote this flow happened to memoize, so neither ever fired
 * there. A package cannot rely on that: `useRedirectActivation({ onVerified:
 * () => reload() })` is the obvious way to call it.
 */
interface ActivationCallbacks {
  applyPoll: (body: ActivationPollBody | null) => boolean;
  returned: () => Record<string, string>;
  timedOut: string;
}

/**
 * Ask the provider every few seconds, and stop asking eventually.
 *
 * The give-up is a `failed` state carrying the host's own sentence, because the
 * wording is load-bearing: the charge is STILL valid, and an owner who has
 * genuinely paid must not be told they did not pay in time.
 */
function usePollTimer(
  active: boolean,
  url: string,
  live: ActivationClock,
  latest: React.MutableRefObject<ActivationCallbacks>,
  setState: React.Dispatch<React.SetStateAction<RedirectActivationState>>,
  pollMs: number,
  pollTimeoutMs: number,
): void {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!live.current.polling) return;
      if (Date.now() - live.current.startedAt > pollTimeoutMs) {
        live.current.polling = false;
        setState({ kind: 'failed', reason: latest.current.timedOut });
        return;
      }
      // WITH the ids, every tick. A hint-less poll is measured to answer "not
      // paid" for payments that happened — one hinted ask on resume made a
      // single dropped request fatal.
      void postActivation(url, 'poll', latest.current.returned()).then((body) =>
        latest.current.applyPoll(body),
      );
    }, pollMs);
    return () => clearInterval(timer);
  }, [active, url, live, latest, setState, pollMs, pollTimeoutMs]);
}

/**
 * Pick the outstanding charge back up on mount.
 *
 * This is what makes the return trip work at all. The owner is sent to the
 * provider's site to pay and comes back here holding the ids that let the
 * payment be confirmed — so the very first thing this does on load is ask
 * whether a charge is outstanding and, if so, check it immediately with
 * whatever the redirect brought back.
 */
function useResumeOutstanding(
  url: string,
  live: ActivationClock,
  latest: React.MutableRefObject<ActivationCallbacks>,
  setState: React.Dispatch<React.SetStateAction<RedirectActivationState>>,
): void {
  useEffect(() => {
    const alive = { current: true };
    const carried = latest.current.returned();

    // An owner who came back holding a settlement has DEMONSTRABLY paid, so the
    // screen must be confirming from the first frame — never showing the pay
    // button, whatever the pending row says and whatever any single request
    // does. `checkoutUrl: null` renders the confirming panel without an
    // open-link button. This also arms the timer, so one dropped request costs
    // four seconds rather than the payment.
    if (Object.keys(carried).length > 0) {
      live.current.polling = true;
      live.current.startedAt = Date.now();
      setState({ kind: 'awaiting', checkoutUrl: null });
    }

    void resumeSequence({ url, live, latest, setState }, carried, alive);

    return () => {
      alive.current = false;
    };
  }, [url, live, latest, setState]);
}

/** Everything the resume sequence reaches for, gathered once. */
interface ResumeIo {
  url: string;
  live: ActivationClock;
  latest: React.MutableRefObject<ActivationCallbacks>;
  setState: React.Dispatch<React.SetStateAction<RedirectActivationState>>;
}

/** The resume sequence, in the order that keeps a paid return confirmable. */
async function resumeSequence(
  io: ResumeIo,
  carried: Record<string, string>,
  alive: { current: boolean },
): Promise<void> {
  const cameBack = Object.keys(carried).length > 0;
  // Fired FIRST, and not gated on the pending GET below: this ask depends on
  // nothing but the returned ids, and chaining it behind another request's
  // success is how a mid-refresh session cookie once turned a confirmed payment
  // into a pay button.
  if (cameBack) {
    const polled = await postActivation(io.url, 'poll', carried);
    if (alive.current) io.latest.current.applyPoll(polled);
  }
  await restoreOutstanding(io, carried, alive, cameBack);
}

/**
 * The GET's answer: the outstanding charge, and whether the server settled it
 * during this very read (its own heal path).
 */
interface OutstandingBody {
  pending?: ActivationPendingBody;
  proven?: boolean;
}

async function readOutstanding(url: string): Promise<OutstandingBody | null> {
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as OutstandingBody | null;
}

/** Restore the server's pending row into the screen, and ask once if idle. */
async function restoreOutstanding(
  io: ResumeIo,
  carried: Record<string, string>,
  alive: { current: boolean },
  cameBack: boolean,
): Promise<void> {
  const body = await readOutstanding(io.url);
  if (!body || !alive.current) return;
  // Settled server-side while we were reading — the charge is done, and the one
  // thing this must not do now is resume a pay flow for it.
  if (body.proven) {
    io.latest.current.applyPoll({ ok: true });
    return;
  }
  const pending = body.pending;
  if (!pending) return;

  io.live.current.polling = true;
  io.live.current.startedAt = Date.parse(pending.startedAt) || Date.now();
  io.setState((current) =>
    current.kind === 'passed' || current.kind === 'failed'
      ? current
      : { kind: 'awaiting', checkoutUrl: pending.checkoutUrl },
  );
  if (!cameBack) {
    const polled = await postActivation(io.url, 'poll', carried);
    if (alive.current) io.latest.current.applyPoll(polled);
  }
}

export function useRedirectActivation(options: RedirectActivationOptions): RedirectActivation {
  const {
    verifyChargeUrl: url,
    onVerified,
    onCreateFailed,
    copy,
    storageKey,
    pollMs = DEFAULT_POLL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  } = options;

  const [state, setState] = useState<RedirectActivationState>({ kind: 'idle' });
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  // Read inside the interval callback so the timer never closes over a stale
  // state — mutating a ref's property rather than reassigning a captured
  // binding, which the flakiness lint rightly rejects.
  const live = useRef({ polling: false, startedAt: 0 });

  const returned = useCallback(() => takeReturnedSettlement(storageKey), [storageKey]);

  const applyPoll = useCallback(
    (body: ActivationPollBody | null): boolean => {
      // Stamped even on a dropped request: the counter reports when we last
      // ASKED, and freezing it on a network blip would read as a stalled screen.
      setLastCheckedAt(Date.now());
      return settleActivationPoll(body, {
        live,
        setState,
        onVerified,
        clearSettlement: () => clearReturnedSettlement(storageKey),
        copy,
      });
    },
    [onVerified, storageKey, copy],
  );

  const latest = useRef<ActivationCallbacks>({
    applyPoll,
    returned,
    timedOut: copy.confirmTimedOut,
  });
  latest.current = { applyPoll, returned, timedOut: copy.confirmTimedOut };

  useResumeOutstanding(url, live, latest, setState);
  usePollTimer(state.kind === 'awaiting', url, live, latest, setState, pollMs, pollTimeoutMs);

  const start = useCallback(
    () => mintCharge({ url, live, setState, copy, onCreateFailed }),
    [url, copy, onCreateFailed],
  );

  const checkNow = useCallback(async () => {
    applyPoll(await postActivation(url, 'poll', returned()));
  }, [applyPoll, url, returned]);

  /**
   * Give up on the outstanding charge — and tell the SERVER so.
   *
   * Clearing only the local state would leave the charge on record, so the very
   * next load would resume the attempt the owner just abandoned.
   */
  const reset = useCallback(() => {
    live.current.polling = false;
    setState({ kind: 'idle' });
    void postActivation(url, 'discard');
  }, [url]);

  return { state, lastCheckedAt, start, checkNow, reset };
}
