import { ProviderRequestError } from '../core/errors';
import type { ChargeSnapshot, ProbeOutcome, ResolvedCredentials } from '../core/types';

import { NAME } from './infinitepay-http';

/**
 * The answers InfinitePay is SCRIPTED to give, in stub mode only.
 *
 * ## Why this exists
 *
 * The activation flow's whole subject is what happens when the provider says
 * no. An InfiniteTag that names no account, an outage mid-probe, a refusal to
 * mint a link because Checkout Integrado is off, a link that expires unpaid, a
 * card the payer's bank declines — those are five different screens with five
 * different instructions, and each one is only reachable by InfinitePay
 * BEHAVING that way. None can be provoked from outside: a real account cannot
 * be asked to time out, and the plain stub only ever answers "fine, pending".
 *
 * So the outcome becomes part of the store's stub credentials. Everything else
 * stays real — the route, the settings service, the pending-verification row,
 * `applyChargeVerification`, the enable gate — and only the outermost HTTP call
 * to InfinitePay is replaced, which is the exact boundary `credentials.stub`
 * already replaces. A test that stubbed our own endpoint would assert the
 * screen's reaction to a body nobody produced.
 *
 * ## Why it cannot escape a test box
 *
 * It is read ONLY inside `if (credentials.stub)`, and `stub` is derived rather
 * than accepted from a caller: `applySaveCredentials` sets it from the
 * deployment's `allowStubMode` AND `environment === 'SANDBOX'`, and both
 * `runVerify` and `credentialsForVerification` re-apply the SANDBOX condition
 * themselves. A production config can therefore never carry it, and a field
 * named here on a live connection is inert data.
 */

/** The credential key a scripted store carries. Absent ⇒ the plain stub. */
export const STUB_OUTCOME_FIELD = 'stubOutcome';

type StubOutcome =
  /** The handle names no InfinitePay account (its live API answers 404). */
  | 'handle-not-found'
  /** No answer at all — DNS, timeout, 5xx. Nothing is learned either way. */
  | 'unreachable'
  /** The account is fine; `POST /links` is refused (Checkout Integrado off). */
  | 'checkout-disabled'
  /** The activation link has been paid — `payment_check` says so. */
  | 'paid'
  /** The link's window elapsed with nobody paying it. */
  | 'expired'
  /** Someone tried and their payment method refused. */
  | 'declined';

const OUTCOMES: readonly StubOutcome[] = [
  'handle-not-found',
  'unreachable',
  'checkout-disabled',
  'paid',
  'expired',
  'declined',
];

/**
 * The script this call is running under, or null for the plain stub.
 *
 * An unrecognised value is null rather than an error: this is a test
 * affordance, and a typo in a fixture must degrade to the ordinary stub rather
 * than take down every charge on the box.
 */
export function stubOutcomeOf(credentials: ResolvedCredentials): StubOutcome | null {
  if (!credentials.stub) return null;
  const value = credentials.fields[STUB_OUTCOME_FIELD];
  return OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/**
 * The shape a network fault arrives in: no HTTP status, because there was no
 * HTTP response. `failureFor` and the poll's `pending: true` classify on
 * exactly that absence, so a scripted outage has to be missing the same field a
 * real one is.
 *
 * It is worth knowing that this is only ONE of the two shapes a real outage
 * wears, and the rarer one. `providerFetch` wraps a RESPONSE in
 * `ProviderRequestError`; when the connection itself fails there is no response
 * to wrap, so undici's bare `TypeError: fetch failed` — carrying a
 * `cause.code` — propagates untouched. `probeFailure` accepts both, and only
 * both: "no status" alone also describes a plain bug in our own code, and
 * reading THAT as an outage is what once made such bugs invisible (see
 * `infinitepay-probe.ts`). A stub cannot easily produce the bare form, so the
 * unit tests in `infinitepay-verify.test.ts` cover it directly.
 */
function unreachable(): ProviderRequestError {
  return new ProviderRequestError(NAME, 'fetch failed: infinitepay.io unreachable', {
    retriable: true,
  });
}

/** The scripted answer to the credential probe, or null to run the plain stub. */
export function stubProbe(outcome: StubOutcome): ProbeOutcome | null {
  if (outcome === 'handle-not-found') {
    return {
      ok: false,
      fault: 'NOT_FOUND',
      message:
        'Não encontramos essa InfiniteTag na InfinitePay. Confira a tag no app e tente de novo.',
    };
  }
  // Not a returned outcome: an outage is a THROW at the HTTP layer, and the
  // adapter's own catch is what turns it into `UNREACHABLE`. Returning the
  // classification directly would skip the code under test.
  if (outcome === 'unreachable') throw unreachable();
  return null;
}

/**
 * The scripted answer to `POST /links`, or null to mint the ordinary stub link.
 *
 * Both branches THROW, and the difference between them is the point: a refusal
 * carries an HTTP status (the account answered), an outage carries none. That
 * one field is what decides whether the screen withdraws the owner's "Checkout
 * Integrado is on" claim or leaves it standing — and getting it wrong sends an
 * owner whose wifi dropped back to re-do a step that was already done.
 */
export function stubCreateFault(outcome: StubOutcome): null {
  if (outcome === 'unreachable') throw unreachable();
  if (outcome === 'checkout-disabled') {
    throw new ProviderRequestError(
      NAME,
      '{"success":false,"message":"Checkout Integrado is not enabled for this account"}',
      {
        retriable: false,
        httpStatus: 422,
        request: {
          method: 'POST',
          url: 'https://api.infinitepay.io/invoices/public/checkout/links',
          headers: {},
        },
      },
    );
  }
  return null;
}

/**
 * An activation reference naming no attempt — `verify-<provider>-<merchant>`
 * with nothing after it.
 *
 * Both mint paths append one (`verificationReference(..., attemptId)`, in the
 * card flow and the redirect flow alike), so a charge under the bare base was
 * never created and cannot be found. An order reference is not an activation
 * reference at all and is left alone.
 */
function namesNoAttempt(reference: string): boolean {
  return reference.startsWith('verify-') && !reference.includes('--');
}

/**
 * The scripted answer to `payment_check`.
 *
 * `undefined` means "not scripted — fall through to the plain stub", which is
 * distinct from the `null` that means "no such payment, keep waiting". The two
 * were one value once and the unpaid answer swallowed the unscripted one.
 *
 * ## Why a reference that names no attempt is refused (FUT-684)
 *
 * The script used to answer for ANY reference, and that is how a caller asking
 * about the WRONG charge became invisible. The poll asked InfinitePay about the
 * bare `verify-<provider>-<merchant>` while `start` had minted
 * `verify-<provider>-<merchant>--<attempt>`; live, `payment_check` answers the
 * same `{"success":false}` it gives nonsense, so the browser could never
 * confirm a paid activation and every settlement silently depended on a webhook
 * reaching a public URL. On a tunnel or a preview box that never happens.
 *
 * The stub said PAID regardless, so the whole defect sat under 25 green
 * end-to-end scenarios for a release. A stub that answers questions the real
 * provider refuses is not a convenience — it is a hole in every test above it.
 */
export function stubFindCharge(
  outcome: StubOutcome,
  reference: string,
): ChargeSnapshot | null | undefined {
  if (outcome === 'unreachable') throw unreachable();
  // `null`, not `undefined`: this IS the scripted answer — "no such payment" —
  // and falling through to the plain stub would hand back the PENDING snapshot
  // that hid the bug in the first place.
  if (namesNoAttempt(reference)) return null;
  const base = {
    provider: NAME,
    providerChargeId: reference,
    reference,
    amount: { amountCents: 101, currency: 'BRL' },
    method: 'PIX' as const,
  };
  if (outcome === 'paid') return { ...base, status: 'PAID' };
  if (outcome === 'expired') return { ...base, status: 'EXPIRED' };
  if (outcome === 'declined') {
    return { ...base, status: 'DECLINED', declineReason: 'CARD_DECLINED' };
  }
  return undefined;
}
