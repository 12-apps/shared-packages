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
 * The failures worth scripting, named after the BUCKET they classify into
 * rather than after a wire symptom — the bucket is the whole point.
 *
 *   not-charged  the provider answered before doing any work (HTTP 400). The
 *                one class that authorises advancing to the next provider.
 *   ambiguous    no usable answer to the CHARGE. The walk must probe, and the
 *                stub's probe answers "no such charge" — so the walk advances,
 *                which is the probe doing its job.
 *   unresolved   no usable answer to the charge NOR to the probe (FUT-3627).
 *                Nobody can prove whether the money moved, so the walk stops
 *                and the buyer is told the payment is being confirmed. Without
 *                this, every stub probe answered and that state — the one the
 *                packaged `quando-o-pagamento-nao-vai` journey is about — could
 *                not be reached against a real backend at all.
 */
export type StubChargeFault = 'not-charged' | 'ambiguous' | 'unresolved';

/**
 * Every scripted fault, exported so a host's fixture writes a NAMED value
 * rather than a string it hopes this file still spells the same way.
 */
export const STUB_CHARGE_FAULTS: readonly StubChargeFault[] = ['not-charged', 'ambiguous', 'unresolved'];

/** The scripted fault on this connection, or `null` for the plain stub. */
function scriptedFault(credentials: ResolvedCredentials | undefined): StubChargeFault | null {
  if (!credentials?.stub) return null;
  const value = credentials.fields[STUB_CHARGE_FAULT_FIELD];
  return STUB_CHARGE_FAULTS.find((candidate) => candidate === value) ?? null;
}

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
  const fault = scriptedFault(credentials);
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

/**
 * The stub's answer to the reconciliation probe (`findChargeByReference`).
 *
 * A stub remembers nothing it raised, so it finds nothing — `null`, which the
 * walk reads as proof that charging elsewhere is safe. Under the `unresolved`
 * script the probe gets no answer either, and a thrown probe is exactly what
 * the walk must never read as "no charge" (`core/charge-attempt.ts`, `probe`).
 */
export function stubFindChargeByReference(
  provider: ProviderName,
  credentials: ResolvedCredentials,
): null {
  if (scriptedFault(credentials) === 'unresolved') {
    throw new ProviderRequestError(provider, `${provider} did not answer the probe (scripted stub)`, {
      retriable: true,
    });
  }
  return null;
}

/**
 * Whether a card token is the stub's "this card is refused" marker.
 *
 * Two spellings, one meaning (FUT-3627). The backend's own convention is a
 * `-declined` SUFFIX; the checkout's mock tokenizer
 * (`@12-apps/payments-frontend`, `card/tokenize.ts`) mints the shared decline
 * PAN as a `tok_declined` PREFIX. Reading only the suffix meant a buyer typing
 * the decline card into a real host was charged PAID, and only the harness —
 * whose in-page adapter honoured both — ever saw the refusal.
 */
export function isStubDeclinedToken(token: string | undefined): boolean {
  if (!token) return false;
  return token.endsWith('-declined') || token.startsWith('tok_declined');
}
