import type React from 'react';
import type { MutableRefObject } from 'react';

import type { RedirectActivationCopy } from './copy';

/**
 * What the redirect activation step can BE, and how one answer from the
 * provider moves it — with no React and no requests anywhere near (FUT-763).
 *
 * Split from the hook because these are the decisions and the hook is the
 * wiring: timers, mount effects, a claimed tab, a memoized callback. Together
 * they were one file nobody could read the rules out of, and the rules are the
 * part that costs money when it is wrong.
 */

export type RedirectActivationState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  /** Link live (URL present) or confirming a return trip (URL null). */
  | {
      kind: 'awaiting';
      checkoutUrl: string | null;
      /**
       * A payment ATTEMPT was refused, on a charge that is still payable.
       *
       * It stays `awaiting` rather than becoming a failure because nothing
       * about the link changed: the card said no, and the next move is another
       * card or another method on this same link. Settling it would clear the
       * outstanding charge and put a button offering to mint a SECOND real one
       * on screen, while the first sits live at the provider.
       */
      declined?: string;
    }
  /** The link's window elapsed unpaid. Nothing was charged; offer another. */
  | { kind: 'expired'; reason: string }
  | { kind: 'passed' }
  | {
      kind: 'failed';
      reason: string;
      providerMessage?: string;
      /**
       * The provider refused to CREATE the link, rather than refusing the
       * payment. A different failure with a different owner: no money moved and
       * nothing is outstanding, and the overwhelmingly likely cause is a
       * provider-side switch still being off — which is a step, not an error.
       */
      atCreation?: boolean;
      /**
       * …unless the provider was never reached at all, in which case it refused
       * nothing and the step the owner already completed must survive untouched.
       */
      transport?: boolean;
    };

/** One answer from the host's verify-charge endpoint. */
export interface ActivationPollBody {
  ok?: boolean;
  pending?: boolean;
  reason?: string;
  providerMessage?: string;
  checkoutUrl?: string;
  /** Which settled-and-negative answer this was. */
  outcome?: 'expired' | 'declined' | 'refused';
  /** The charge is still payable; the server deliberately kept it outstanding. */
  retryable?: boolean;
  /** `start` only: the provider was never reached, so it refused nothing. */
  transport?: boolean;
}

/** The outstanding charge, as the server remembers it. */
export interface ActivationPendingBody {
  reference: string;
  checkoutUrl: string;
  slug?: string;
  startedAt: string;
}

/**
 * Ask the host's endpoint to start, poll, or discard the activation charge.
 *
 * A thrown fetch and an unparsable body both answer `null`, which is the same
 * fact one layer out: nothing came back. {@link refusedByProvider} is what
 * turns that into a decision.
 */
export async function postActivation(
  url: string,
  action: 'start' | 'poll' | 'discard',
  extra: Record<string, string> = {},
): Promise<ActivationPollBody | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return (await response.json().catch(() => null)) as ActivationPollBody | null;
  } catch {
    return null;
  }
}

/** Live poll bookkeeping, mutated in place so a timer never reads a stale copy. */
export type ActivationClock = MutableRefObject<{ polling: boolean; startedAt: number }>;

/** What {@link settleActivationPoll} needs besides the answer itself. */
export interface SettlePollIo {
  live: ActivationClock;
  setState: React.Dispatch<React.SetStateAction<RedirectActivationState>>;
  onVerified: () => void;
  /** Drop the parked return-trip ids — the charge is done with them. */
  clearSettlement: () => void;
  copy: RedirectActivationCopy;
}

/**
 * Turn one poll answer into the screen's state, and say whether it SETTLED.
 *
 * Four outcomes, and the two in the middle are the ones worth naming. A
 * `retryable` refusal is a payment ATTEMPT that failed on a charge still
 * sitting live at the provider — so it stays `awaiting`, keeps the link on
 * screen (paying it with another method is the entire fix) and does not stop
 * the timer. An `expired` charge is the opposite: nobody can pay it now, so the
 * only useful offer is another one.
 */
export function settleActivationPoll(body: ActivationPollBody | null, io: SettlePollIo): boolean {
  if (!body) return false;
  if (body.ok) {
    io.live.current.polling = false;
    io.clearSettlement();
    io.setState({ kind: 'passed' });
    io.onVerified();
    return true;
  }
  if (body.pending) return false;
  if (body.retryable) {
    const declined = body.reason ?? '';
    io.setState((current) =>
      current.kind === 'awaiting'
        ? { ...current, declined }
        : { kind: 'awaiting', checkoutUrl: null, declined },
    );
    return false;
  }
  io.live.current.polling = false;
  io.clearSettlement();
  if (body.outcome === 'expired') {
    io.setState({ kind: 'expired', reason: body.reason ?? io.copy.chargeExpired });
    return true;
  }
  io.setState({
    kind: 'failed',
    reason: body.reason ?? io.copy.confirmFailed,
    providerMessage: body.providerMessage,
  });
  return true;
}

/**
 * Did the PROVIDER refuse, or was it simply never reached?
 *
 * `transport` says the request produced no response; a null body says the
 * browser's own fetch threw, which is the same thing one layer out. Either way
 * nothing was refused — and the distinction matters because a refusal, and only
 * a refusal, is evidence that a step the owner ticked off is not in fact done.
 * Treating an outage as one sends someone whose network blinked back to redo a
 * finished step, to change a setting that was already correct.
 */
export function refusedByProvider(body: ActivationPollBody | null): boolean {
  return Boolean(body) && !body?.transport;
}

/** The failed state a refused (or unreachable) `start` leaves behind. */
export function creationFailure(
  body: ActivationPollBody | null,
  copy: RedirectActivationCopy,
): RedirectActivationState {
  return {
    kind: 'failed',
    reason: body?.reason ?? copy.createFailed,
    providerMessage: body?.providerMessage,
    atCreation: true,
    ...(refusedByProvider(body) ? {} : { transport: true }),
  };
}
