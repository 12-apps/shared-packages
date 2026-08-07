import { PaymentsError } from './errors';
import type { PaymentEnvironment, ResolvedCredentials } from './types';

/**
 * Whether this deployment may run providers in STUB mode — one definition,
 * shared by every host, because the hosts kept inventing worse ones.
 *
 * Stub mode replaces the acquirer: a stub card charge reports `PAID` with no
 * money moving, and a stub webhook delivery authenticates with no signature.
 * That is a local-dev and CI affordance, and it is only safe while the answer
 * to "is this deployment allowed to fake payments?" is a DELIBERATE yes.
 *
 * It was being INFERRED instead — a host read `!process.env.PAGBANK_TOKEN`,
 * i.e. "we have no PagBank token, so this must be a laptop". A Stripe-only
 * production deploy has no PagBank token either, so every SANDBOX connection
 * on it ran stubbed: the webhook verifiers short-circuit on `credentials.stub`
 * (`providers/stripe.ts`, `providers/stone.ts`, `providers/pagbank.ts`,
 * `providers/infinitepay-webhook.ts`), so an ANONYMOUS, unsigned POST to the
 * public webhook endpoint authenticated, settled the amount it named itself,
 * and stamped the activation proof that switches a provider on.
 *
 * So the gate is explicit (`PAYMENTS_STUB=1`), absent means OFF, and asking
 * for it in production is refused outright rather than quietly downgraded —
 * a production environment carrying that variable is a loaded gun, not a
 * preference to be ignored.
 */

/** The one environment variable that turns stub mode on. */
export const STUB_MODE_ENV_VAR = 'PAYMENTS_STUB';

/** The slice of the process environment this policy reads. */
export interface StubModeEnv {
  PAYMENTS_STUB?: string | undefined;
  NODE_ENV?: string | undefined;
}

/** Stub mode was asked for somewhere it can never be granted. */
export class StubModeRefusedError extends PaymentsError {
  constructor(message: string) {
    super('StubModeRefusedError', message);
  }
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * Read the deployment's stub-mode decision out of an environment.
 *
 * Pure, and takes the environment as an argument, because this package reads
 * no globals — the host passes `process.env` at startup and hands the result
 * to `createSettingsService` and `credentialStoreFrom`.
 *
 * Throws in production rather than returning `false`: silently ignoring
 * `PAYMENTS_STUB=1` there leaves the variable in place, one `NODE_ENV`
 * accident away from serving fake payments to real buyers. Refusing at
 * startup is the only moment anyone is still watching.
 */
export function resolveStubMode(env: StubModeEnv): boolean {
  const asked = TRUTHY.has((env.PAYMENTS_STUB ?? '').trim().toLowerCase());
  if (!asked) return false;
  if (env.NODE_ENV === 'production') {
    throw new StubModeRefusedError(
      `${STUB_MODE_ENV_VAR} is set in a NODE_ENV=production deployment. ` +
        'Stub mode fakes charges and accepts unsigned webhooks; it is never ' +
        'available in production. Unset the variable.',
    );
  }
  return true;
}

/**
 * May THIS delivery be believed on the strength of its stub flag alone?
 *
 * Every webhook verifier has a branch that passes a delivery no signature
 * could have authenticated — there is no secret to check in stub mode. Those
 * branches all route through here so the condition is stated once and can be
 * tightened once, and so the flag alone is never enough: a PRODUCTION-
 * environment credential is refused even if something upstream managed to
 * mark it stubbed, because a production connection takes real money and a
 * forged delivery about it settles a real order.
 */
export function stubDeliveryTrusted(credentials: ResolvedCredentials): boolean {
  return credentials.stub === true && credentials.environment === 'SANDBOX';
}

/**
 * Does THIS credential read resolve as stubbed? The one place that decides.
 *
 * Every path that turns a stored row into credentials an adapter will act on
 * — the charge/webhook store (`resolvedFrom`), the activation charge
 * (`credentialsForVerification`) and the "Testar conexão" probe (`runVerify`)
 * — asks this and nothing else. The rule was written out by hand at each site
 * instead, and the probe's copy was missing `allowStubMode` entirely: it read
 * the persisted column on its own, so a left-over `stub=true` row answered
 * `ok: true` with no request to the acquirer and stamped VERIFIED on a
 * connection holding no credentials at all.
 *
 * `allowStubMode` is the deployment's own answer from {@link resolveStubMode},
 * and it is REQUIRED here — a row outlives the deployment that wrote it, so
 * the column says what was true when it was written and never what is true
 * now. SANDBOX-only for the same reason `stubDeliveryTrusted` is: a production
 * connection moves real money, and nothing about it may be faked.
 */
export function stubResolvedFor(
  allowStubMode: boolean | undefined,
  storedStub: boolean | undefined,
  environment: PaymentEnvironment,
): boolean {
  return allowStubMode === true && storedStub === true && environment === 'SANDBOX';
}
