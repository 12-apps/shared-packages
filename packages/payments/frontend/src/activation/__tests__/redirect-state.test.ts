import { describe, expect, it, vi } from 'vitest';

import type { RedirectActivationCopy } from '../copy';
import {
  creationFailure,
  refusedByProvider,
  settleActivationPoll,
  type ActivationClock,
  type ActivationPollBody,
  type RedirectActivationState,
} from '../redirect-state';

/**
 * The decisions the redirect activation step is made of, with no React and no
 * network in sight.
 *
 * Every case here is a payment that went wrong once. The two worth stating in
 * advance: a REFUSED ATTEMPT is not a settled charge (the link is still live,
 * and settling it offers to mint a second real one), and an UNREACHABLE
 * provider has refused nothing (treating an outage as a refusal sends an owner
 * back to re-do a step that was already correct).
 */

const COPY: RedirectActivationCopy = {
  chargeExpired: 'copy:expired',
  confirmFailed: 'copy:confirm-failed',
  createFailed: 'copy:create-failed',
  confirmTimedOut: 'copy:timed-out',
};

/** A state container plus the clock, driven exactly as the hook drives them. */
function harness(initial: RedirectActivationState = { kind: 'idle' }) {
  const box = { state: initial };
  const live: ActivationClock = { current: { polling: true, startedAt: 1 } };
  const onVerified = vi.fn();
  const clearSettlement = vi.fn();
  const setState = (next: React.SetStateAction<RedirectActivationState>): void => {
    box.state = typeof next === 'function' ? next(box.state) : next;
  };
  return {
    box,
    live,
    onVerified,
    clearSettlement,
    io: { live, setState, onVerified, clearSettlement, copy: COPY },
  };
}

describe('settleActivationPoll', () => {
  it('treats no answer as no news — nothing settles, the timer keeps running', () => {
    const h = harness();
    expect(settleActivationPoll(null, h.io)).toBe(false);
    expect(h.box.state).toEqual({ kind: 'idle' });
    expect(h.live.current.polling).toBe(true);
    expect(h.clearSettlement).not.toHaveBeenCalled();
  });

  it('passes on ok: stops polling, drops the parked ids and tells the caller', () => {
    const h = harness();
    expect(settleActivationPoll({ ok: true }, h.io)).toBe(true);
    expect(h.box.state).toEqual({ kind: 'passed' });
    expect(h.live.current.polling).toBe(false);
    expect(h.clearSettlement).toHaveBeenCalledTimes(1);
    expect(h.onVerified).toHaveBeenCalledTimes(1);
  });

  it('keeps asking while the answer is pending', () => {
    const h = harness({ kind: 'awaiting', checkoutUrl: 'https://pay.example/abc' });
    expect(settleActivationPoll({ pending: true }, h.io)).toBe(false);
    expect(h.box.state).toEqual({ kind: 'awaiting', checkoutUrl: 'https://pay.example/abc' });
    expect(h.live.current.polling).toBe(true);
  });

  it('a retryable refusal keeps the LINK on screen — the charge is still payable', () => {
    const h = harness({ kind: 'awaiting', checkoutUrl: 'https://pay.example/abc' });
    const settled = settleActivationPoll({ retryable: true, reason: 'cartão recusado' }, h.io);

    expect(settled).toBe(false);
    expect(h.box.state).toEqual({
      kind: 'awaiting',
      checkoutUrl: 'https://pay.example/abc',
      declined: 'cartão recusado',
    });
    // The link is live at the provider: stopping here, or clearing the parked
    // ids, is how a second real charge gets offered for the same activation.
    expect(h.live.current.polling).toBe(true);
    expect(h.clearSettlement).not.toHaveBeenCalled();
  });

  it('a retryable refusal from a non-awaiting state still lands in awaiting', () => {
    const h = harness({ kind: 'creating' });
    settleActivationPoll({ retryable: true }, h.io);
    expect(h.box.state).toEqual({ kind: 'awaiting', checkoutUrl: null, declined: '' });
  });

  it('an expired charge settles as expired, not as a failure', () => {
    const h = harness({ kind: 'awaiting', checkoutUrl: 'https://pay.example/abc' });
    expect(settleActivationPoll({ outcome: 'expired' }, h.io)).toBe(true);
    expect(h.box.state).toEqual({ kind: 'expired', reason: COPY.chargeExpired });
    expect(h.live.current.polling).toBe(false);
    expect(h.clearSettlement).toHaveBeenCalledTimes(1);
  });

  it("prefers the server's own reason over the host's fallback sentence", () => {
    const h = harness();
    settleActivationPoll({ outcome: 'expired', reason: 'o link venceu' }, h.io);
    expect(h.box.state).toEqual({ kind: 'expired', reason: 'o link venceu' });
  });

  it('a settled refusal fails, carrying the provider message through', () => {
    const h = harness();
    const settled = settleActivationPoll(
      { outcome: 'refused', providerMessage: 'INVALID_HANDLE' },
      h.io,
    );

    expect(settled).toBe(true);
    expect(h.box.state).toEqual({
      kind: 'failed',
      reason: COPY.confirmFailed,
      providerMessage: 'INVALID_HANDLE',
    });
    expect(h.live.current.polling).toBe(false);
  });
});

describe('refusedByProvider', () => {
  it('a body is a refusal — the provider answered', () => {
    expect(refusedByProvider({ ok: false, reason: 'no' })).toBe(true);
  });

  it('no body at all is not a refusal — the fetch threw', () => {
    expect(refusedByProvider(null)).toBe(false);
  });

  it('a transport failure is not a refusal — the provider was never reached', () => {
    expect(refusedByProvider({ transport: true, reason: 'timeout' })).toBe(false);
  });
});

describe('creationFailure', () => {
  it('marks a refusal at creation, without a transport flag', () => {
    const state = creationFailure({ reason: 'checkout off', providerMessage: 'DISABLED' }, COPY);
    expect(state).toEqual({
      kind: 'failed',
      reason: 'checkout off',
      providerMessage: 'DISABLED',
      atCreation: true,
    });
  });

  it('flags transport when nothing came back, so the owner keeps their step', () => {
    const state = creationFailure(null, COPY) as Extract<
      RedirectActivationState,
      { kind: 'failed' }
    >;
    expect(state.reason).toBe(COPY.createFailed);
    expect(state.atCreation).toBe(true);
    expect(state.transport).toBe(true);
  });

  it('flags transport when the body says so, even though a body exists', () => {
    const state = creationFailure({ transport: true }, COPY) as Extract<
      RedirectActivationState,
      { kind: 'failed' }
    >;
    expect(state.transport).toBe(true);
  });
});

describe('the poll body contract', () => {
  it('ok wins over every negative flag beside it', () => {
    // The server settles a charge during the very read that reports it; the
    // answer it sends carries `ok` alongside whatever it already knew.
    const body: ActivationPollBody = { ok: true, retryable: true, outcome: 'declined' };
    const h = harness();
    expect(settleActivationPoll(body, h.io)).toBe(true);
    expect(h.box.state).toEqual({ kind: 'passed' });
  });
});
