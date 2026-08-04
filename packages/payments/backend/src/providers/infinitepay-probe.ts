import { ProviderRequestError } from '../core/errors';
import { isTransportError } from '../core/failover';
import type { ProbeOutcome } from '../core/types';

/**
 * Reading InfinitePay's refusal of a credential probe.
 *
 * Its own module because the reading is a different job from the asking, and a
 * bigger one: `verifyCredentials` is a handle check and one call, while this is
 * five verdicts that each send the owner somewhere different — and one of them
 * sends them nowhere on purpose.
 */

/**
 * Was there no answer to read, as opposed to an answer we did not like?
 *
 * The one question in this file that is not about a status code, and the one
 * the rest is worthless without. Two shapes count:
 *
 *   - a recognized transport `cause.code` — the network failed, and
 *   - a `ProviderRequestError` carrying no status, which is how an adapter
 *     reports a response it could not read at all.
 *
 * Deliberately NOT "the error has no HTTP status". That was the old test, and
 * it is true of every throw that never came from the HTTP layer — a `TypeError`
 * in this package, a parse failure, any bug of ours. See {@link probeFailure}
 * for what treating those as an outage actually did.
 *
 * The class cannot decide it either: `providerFetch` wraps a RESPONSE in
 * `ProviderRequestError`, so a genuine network failure arrives as the bare
 * `TypeError: fetch failed` undici threw — the same class our own bugs wear.
 * The `cause.code` undici attaches, and our bugs do not carry, is the only
 * place the two actually differ.
 */
function noAnswerArrived(error: unknown, refusal: ProviderRequestError | null): boolean {
  if (isTransportError(error)) return true;
  return refusal !== null && refusal.options.httpStatus === undefined;
}

/**
 * What a probe failure MEANS, in the terms the screen acts on.
 *
 * `UNREACHABLE` is the branch to be careful with, because it is the only
 * verdict that is not written down: `runVerify` skips the store for it on
 * purpose, so that an outage cannot overwrite a perfectly good tag with
 * `FAILED`. That exemption is right for an outage and poisonous for anything
 * else — a bug of ours classified as UNREACHABLE told the owner InfinitePay was
 * down, left no status, no failing screen and no record of itself, and invited
 * them to "teste de novo em instantes" forever. Unfalsifiable, and blamed on
 * the provider.
 *
 * So the branch demands positive evidence ({@link noAnswerArrived}) and
 * everything else falls through to `REFUSED`, which IS recorded — a loud wrong
 * answer being strictly better here than a silent one.
 */
export function probeFailure(error: unknown): ProbeOutcome {
  // InfinitePay's own answer, or null when the throw never came from a response
  // at all. Kept as the ERROR rather than flattened straight to a status,
  // because "answered without a status" and "never answered" are different
  // facts, and conflating them is the bug above.
  const refusal = error instanceof ProviderRequestError ? error : null;
  const status = refusal?.options.httpStatus;
  // 404 is the OPPOSITE of what this used to assume. Measured against the
  // live API with a known-good and a known-bad handle:
  //
  //   real handle   200 {"success":false}                    → resolved, no payment
  //   bogus handle  404 {"success":false,"message":"Not found"} → no such handle
  //
  // Reading 404 as success made the probe pass every string an owner could
  // type, which is the one thing it exists to catch: the InfiniteTag decides
  // WHERE the money lands, and a typo pays a stranger.
  if (status === 404) {
    return {
      ok: false,
      fault: 'NOT_FOUND',
      // Names the provider and where to look, because only this adapter knows
      // either. "Confira as credenciais deste ambiente" — the sentence this
      // replaced — is advice you can follow all afternoon without ever finding
      // the one screen in the InfinitePay app that states the tag.
      message:
        'Não encontramos essa InfiniteTag na InfinitePay. Confira a tag no app e tente de novo.',
    };
  }
  // 422 stays a pass: the handle resolved and only the reference was refused.
  if (status === 422) return { ok: true };
  if (status === 401 || status === 403) {
    return { ok: false, fault: 'REFUSED', message: 'Handle recusado pela InfinitePay.' };
  }
  // Nothing was learned about the tag, so the screen must not send the owner to
  // re-read it — it is already saved, and asking again in a moment is the fix.
  if (noAnswerArrived(error, refusal)) {
    return {
      ok: false,
      fault: 'UNREACHABLE',
      message:
        'Não conseguimos falar com a InfinitePay agora. Sua tag foi salva — teste a conexão de novo em instantes.',
    };
  }
  return {
    ok: false,
    fault: 'REFUSED',
    message: error instanceof Error ? error.message : String(error),
  };
}
