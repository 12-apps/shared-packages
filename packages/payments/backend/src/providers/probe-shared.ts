import { ProviderRequestError } from '../core/errors';
import { isTransportError } from '../core/failover';
import type { ProbeOutcome } from '../core/types';

/**
 * The transport half of a credential-probe failure, shared by every adapter.
 *
 * `runVerify` refuses to persist a verdict only when the probe answers
 * `fault: 'UNREACHABLE'` — and until this helper existed, only InfinitePay ever
 * said it. Stripe, PagBank and Stone returned `{ok: false}` with no fault for a
 * network failure, so a DNS blip during "Testar conexão" stamped `FAILED` over
 * perfectly good credentials, and the only way back was re-saving them — the
 * exact regression the `runVerify` guard was written to prevent (FUT-581 fixed
 * it for InfinitePay alone; FUT-695 is the other three).
 */

/**
 * Was there no answer to read, as opposed to an answer we did not like?
 *
 * Two shapes count, and only these two — the reasoning (and the measurement
 * behind it) lives on `infinitepay-probe.ts`, which asked this question first:
 *
 *   - a recognized transport `cause.code` — the network failed;
 *   - a `ProviderRequestError` with no HTTP status — a response that could not
 *     be read at all.
 *
 * Deliberately NOT "the error has no HTTP status": that is true of every throw
 * that never came from the HTTP layer, including our own bugs, and classifying
 * those as an outage blames the provider for a fault of ours while leaving no
 * record of it anywhere.
 */
export function noAnswerArrived(error: unknown): boolean {
  if (isTransportError(error)) return true;
  return error instanceof ProviderRequestError && error.options.httpStatus === undefined;
}

/**
 * The `UNREACHABLE` verdict when {@link noAnswerArrived}, else `null` so the
 * adapter maps the provider's actual answer itself (status codes and their
 * meanings are the one genuinely per-provider part of a probe).
 *
 * The CLASSIFICATION is what this shares; the sentence arrives from the
 * adapter's copy pack (FUT-760). It used to compose one here around a
 * `providerSentence` fragment — "a Stripe", "o PagBank" — which made this
 * function decide the Portuguese around a vendor's name whose article only
 * Portuguese has. A whole sentence per provider is the honest unit: the pack
 * writes it, and a language that orders it differently is free to.
 */
export function unreachableOutcome(error: unknown, unreachable: string): ProbeOutcome | null {
  if (!noAnswerArrived(error)) return null;
  return { ok: false, fault: 'UNREACHABLE', message: unreachable };
}
