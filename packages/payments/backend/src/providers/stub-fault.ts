import { ProviderRequestError } from '../core/errors';
import type { ProviderName, ResolvedCredentials } from '../core/types';

/**
 * A charge failure a stub connection is SCRIPTED to produce.
 *
 * ## Why this exists
 *
 * Failover is a story about the FIRST provider failing, and the whole safety
 * property is which KIND of failure it was: only a failure proven to predate
 * any charge lets the walk advance (see `core/failover.ts`). None of that is
 * provokable from outside — a real acquirer cannot be asked to refuse, and the
 * plain stub only ever answers "fine". So a chain whose head must fail has to
 * say so in its own stub credentials, exactly as `infinitepay-stub.ts` scripts
 * the activation flow's refusals.
 *
 * Everything above the outermost provider call stays real: the checkout route,
 * the walk, the classification, the ledger, the probe, the second provider's
 * charge and the order's bookkeeping. Only the adapter's answer is replaced —
 * the same boundary `credentials.stub` already replaces.
 *
 * ## Why it cannot escape a test box
 *
 * It is read ONLY inside `if (credentials.stub)`, and `stub` is derived rather
 * than accepted from a caller: `applySaveCredentials` sets it from the
 * deployment's `allowStubMode` AND `environment === 'SANDBOX'`. A production
 * config can therefore never carry it, and a field named here on a live
 * connection is inert data.
 */

/** The credential key a scripted connection carries. Absent ⇒ the plain stub. */
export const STUB_CHARGE_FAULT_FIELD = 'stubChargeFault';

/**
 * The two failures worth scripting, named after the BUCKET they classify into
 * rather than after a wire symptom — the bucket is the whole point.
 *
 *   not-charged  the provider answered before doing any work (HTTP 400). The
 *                one class that authorises advancing to the next provider.
 *   ambiguous    no usable answer at all. The walk must PROBE, never advance
 *                blind, and stop when the probe cannot settle it.
 */
type StubChargeFault = 'not-charged' | 'ambiguous';

const FAULTS: readonly StubChargeFault[] = ['not-charged', 'ambiguous'];

/**
 * Throw the failure this connection is scripted to produce, or return so the
 * plain stub answers.
 *
 * An unrecognised value returns rather than throwing: this is a test
 * affordance, and a typo in a fixture must degrade to the ordinary stub rather
 * than take every charge on the box down with it.
 */
export function applyStubChargeFault(
  provider: ProviderName,
  credentials: ResolvedCredentials | undefined,
): void {
  if (!credentials?.stub) return;
  const value = credentials.fields[STUB_CHARGE_FAULT_FIELD];
  const fault = FAULTS.find((candidate) => candidate === value);
  if (!fault) return;
  if (fault === 'not-charged') {
    // A STATUS is what makes this safe: 400 means the provider answered and
    // created nothing, which `classifyFailure` reads as DEFINITELY_NOT_CHARGED.
    throw new ProviderRequestError(provider, `${provider} refused the charge (scripted stub)`, {
      retriable: false,
      httpStatus: 400,
    });
  }
  // Deliberately WITHOUT a status: no usable response is exactly what makes a
  // failure ambiguous, and inventing a 5xx would be a second way to say it.
  throw new ProviderRequestError(provider, `${provider} did not answer (scripted stub)`, {
    retriable: true,
  });
}
