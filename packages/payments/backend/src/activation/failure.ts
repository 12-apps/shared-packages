import { ProviderRequestError } from '../core/errors';
import { isTransportError } from '../core/failover';

/**
 * How a verification failure is told to the owner (FUT-463 / FUT-489 /
 * FUT-686) — pure classification, no I/O.
 */

/**
 * How a settled-and-negative poll ended, when the screen must react to WHICH
 * negative it was.
 *
 * `expired` and `declined` are two different sentences and two different next
 * actions. An expired link cannot be paid by anyone any more, so the only
 * offer left is a fresh one; a declined payment leaves the link perfectly
 * live, and the fix is another card or Pix on the SAME charge. Collapsed into
 * one "não foi aprovada (STATUS)" they shared a screen that told the owner to
 * try again against a link that could no longer work — or threw away a link
 * that still could.
 */
export type PollOutcome = 'expired' | 'declined' | 'refused';

/** Extra flags the redirect poll can carry back to its route. */
export interface PollFlags {
  /** Still open at the provider — nothing settled, keep asking. */
  pending?: boolean;
  /** Proven by an EARLIER settlement (e.g. the webhook); apply nothing. */
  alreadyProven?: boolean;
  /** Which settled-and-negative answer this was. Absent on a pass or a wait. */
  outcome?: PollOutcome;
  /**
   * The charge is still payable, so it must OUTLIVE this answer.
   *
   * The one case is a declined payment method: the link is untouched and the
   * owner's next move is to pay it with a different one. Settling it here
   * would clear the pending row (`applyProof` clears it either way), and the
   * screen would then offer to mint a second real charge for a first one that
   * is still sitting there, live, waiting to be paid.
   */
  retryable?: boolean;
}

export type VerifyChargeResult =
  | { ok: true; refunded: boolean }
  /**
   * `providerMessage` is present only when {@link failureFor} REPLACED the
   * provider's words with our own. It is the raw refusal, shown on screen so
   * the owner can read it back to the provider's support line — nothing logs
   * or stores it.
   *
   * `transport` is {@link VerificationFailure}'s flag, carried through so a
   * host can tell "the provider refused" from "we never reached it" — the
   * card flow's failures ride this type back to the route, and a host that
   * revokes state on every failure needs the distinction (FUT-679/FUT-686).
   */
  | { ok: false; reason: string; providerMessage?: string; transport?: boolean };

/** What {@link failureFor} classified — the reason plus the raw exchange. */
export interface VerificationFailure {
  reason: string;
  providerMessage?: string;
  transport?: boolean;
}

/**
 * The provider's own words, trimmed to something an owner can act on.
 *
 * `ACCESS_DENIED` is singled out because it is the one failure the store owner
 * cannot do anything about. PagBank refuses real charges until it has released
 * the integration, and under Connect the integration being released is the
 * PLATFORM's — one application, approved once, for every store on it. Telling
 * the owner to "complete the homologação" sent them after a task that was
 * never theirs. Say who is responsible and stop there.
 *
 * `transport` marks a failure with NO answer: DNS, a timeout, a reset. The
 * provider refused nothing, so nothing the owner has told us is called into
 * question — which matters because callers REVOKE the owner's "Checkout
 * Integrado is on" claim on a refusal, and doing that for a dropped connection
 * sends someone whose wifi blinked back to redo a finished step. Two shapes
 * count (FUT-686): the bare `TypeError: fetch failed` undici throws (with the
 * `cause.code` that separates an outage from a bug of ours, as `probeFailure`
 * classifies, FUT-581), and a status-less `ProviderRequestError` (the response
 * never parsed) — `providerFetch` only wraps a RESPONSE.
 */
export function failureFor(error: unknown): VerificationFailure {
  const message = error instanceof Error ? error.message : String(error);
  const raw = rawExchange(error, message);
  const transport =
    isTransportError(error) ||
    (error instanceof ProviderRequestError && error.options.httpStatus === undefined);

  if (message.includes('ACCESS_DENIED') || message.includes('whitelist')) {
    return {
      reason:
        'O PagBank ainda não liberou cobranças reais para esta plataforma. Isso é resolvido ' +
        'por nós, não pela sua loja — nossa equipe já está tratando e avisaremos assim que ' +
        'estiver liberado.',
      providerMessage: raw,
      ...(transport ? { transport } : {}),
    };
  }
  // Every failure carries the exchange, for every provider — not only the one
  // whose text we reword. The owner-facing sentence answers "whose problem is
  // this"; the block below answers "what exactly did the provider say", which
  // is what support asks for and what homologação requires submitted.
  // Truncating the reason but keeping the pair intact is the point: it was
  // truncation that made the original failure undiagnosable.
  return {
    reason: message.slice(0, 300),
    providerMessage: raw,
    ...(transport ? { transport } : {}),
  };
}

/**
 * What to TELL the owner when we could not reach the provider at all.
 *
 * Composed where the adapter is in hand so it can name the vendor: "não
 * conseguimos falar com o provedor" is the same sentence with the one useful
 * word removed. The raw exchange still rides along in `providerMessage`; this
 * replaces only the sentence an owner is expected to act on, and the action it
 * asks for — wait, try again — is the correct one for an outage and the wrong
 * one for every other failure, which is why it is gated on `transport`.
 */
export function unreachableReason(displayName: string): string {
  return `Não conseguimos falar com a ${displayName} agora. Tente de novo em instantes.`;
}

/**
 * What we SENT beside what came back, when the adapter preserved it (FUT-489).
 *
 * PagBank support — and the homologação form — ask for "o log completo",
 * meaning the pair. `ProviderRequestError` already carries a redacted request
 * snapshot; nothing was showing it. Falls back to the message alone for errors
 * that have no snapshot (network failures, non-HTTP faults).
 */
function rawExchange(error: unknown, message: string): string {
  const snapshot = error instanceof ProviderRequestError ? error.options.request : undefined;
  if (!snapshot) return message.slice(0, 500);
  const { method, url, body } = snapshot;
  const sent = body === undefined ? '' : `\n${JSON.stringify(body, null, 2).slice(0, 1500)}`;
  return `→ ${method} ${url}${sent}\n\n← ${message.slice(0, 1000)}`;
}
