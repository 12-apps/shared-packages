/**
 * A dangerous act on captured money — give the cash back, refund the card,
 * pay change or credit out of a capture — confirmed by the person's reason
 * and PIN, and sent AT ONCE.
 *
 * There is no undo window: the reason and the PIN are the confirmation (owner
 * decision T2 on FUT-4996, 2026-11-14, which departs from the approved frame's
 * undo). The server checks the permission, the PIN and the reason again; this
 * only keeps a short reason, an empty PIN or a double tap from being sent.
 */

/** The shortest reason the server takes. */
export const MIN_REASON_LENGTH = 3;

export interface ConfirmedActInput<TAct extends string> {
  readonly act: TAct;
  readonly reason: string;
  readonly pin: string;
}

/** What sending answered: done, or the host's refusal code (`DANGER_PIN_REQUIRED`, …). */
export type ConfirmedActAnswer = { readonly ok: true } | { readonly ok: false; readonly code: string };

export type ConfirmedActState = 'idle' | 'sending' | 'sent' | 'refused';

/** Why a confirm was not sent: no reason, or no PIN. */
export type ConfirmedActProblem = 'reason' | 'pin';

export interface ConfirmedAct<TAct extends string> {
  /**
   * Send the act now, with the reason (trimmed) and the PIN. A reason under
   * {@link MIN_REASON_LENGTH} or an empty PIN sends nothing and answers the
   * problem; a confirm while one is in flight (`IN_FLIGHT`) or after the act
   * was done (`ALREADY_SENT`) sends nothing either.
   */
  confirm(input: ConfirmedActInput<TAct>): Promise<ConfirmedActAnswer | { readonly ok: false; readonly problem: ConfirmedActProblem }>;
  state(): ConfirmedActState;
}

/** What is wrong with a confirm before it is sent, or null. */
export function problemOf(reason: string, pin: string): ConfirmedActProblem | null {
  if (reason.trim().length < MIN_REASON_LENGTH) return 'reason';
  return pin.trim().length === 0 ? 'pin' : null;
}

export function createConfirmedAct<TAct extends string>(options: {
  readonly send: (input: ConfirmedActInput<TAct>) => Promise<ConfirmedActAnswer>;
}): ConfirmedAct<TAct> {
  let state: ConfirmedActState = 'idle';
  return {
    async confirm(input) {
      const problem = problemOf(input.reason, input.pin);
      if (problem !== null) return { ok: false, problem };
      if (state === 'sending') return { ok: false, code: 'IN_FLIGHT' };
      // Done once: a tap after the act was done is never sent again.
      if (state === 'sent') return { ok: false, code: 'ALREADY_SENT' };
      state = 'sending';
      try {
        const answer = await options.send({ act: input.act, reason: input.reason.trim(), pin: input.pin.trim() });
        state = answer.ok ? 'sent' : 'refused';
        return answer;
      } catch (error) {
        state = 'refused';
        throw error;
      }
    },
    state: () => state,
  };
}
