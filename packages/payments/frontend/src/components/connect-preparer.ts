import type { PaymentEnvironment } from '@12-apps/payments-backend';

import type { PrepareConnect } from './ProviderPanel';

/**
 * The START of the connect round trip (FUT-763) — the sibling of
 * `takeConnectReturn`, which owns its end.
 *
 * Before an owner is sent to the provider's site, a CSRF state is minted on
 * the host's server, pinned to an httpOnly cookie there and compared on the
 * way back. The browser only relays it, so a forged connect cannot start here
 * — and the environment travels sealed into that same cookie, so a SANDBOX
 * choice cannot come back as a PRODUCTION grant.
 *
 * The ROUTE that mints it is the host's; everything else about the exchange is
 * this package's, and was being restated by every host that implemented
 * `prepareConnect` by hand: the method, the content type, what a failure is,
 * and the shape of the answer. That last one is the reason this exists rather
 * than a copied snippet — see below.
 */

/** What the host's prepare endpoint answers. */
interface PreparedConnect {
  state: string;
  redirectUri: string;
  environment?: PaymentEnvironment;
}

export interface ConnectPreparerOptions {
  /**
   * The host's OAuth-prepare endpoint for one provider and environment.
   *
   * A builder rather than a whole URL because the provider is not fixed for
   * this screen the way it is for a verification charge — the owner picks one,
   * and the route shape still belongs to the host.
   */
  prepareUrl: (provider: string, environment: PaymentEnvironment) => string;
  /**
   * What the owner is told when no connect could be started.
   *
   * Required and with no default, like every other sentence this package
   * needs: a fallback compiled in here is how one product's voice reaches
   * every adopter.
   */
  mintFailed: string;
}

/** The two environments, for checking what came back is one of them. */
const ENVIRONMENTS: readonly PaymentEnvironment[] = ['SANDBOX', 'PRODUCTION'];

/**
 * Refuse an answer that cannot start a connect.
 *
 * A hand-written preparer casts the body and hands it straight on, so a `200`
 * carrying the wrong shape sends the owner to the provider with
 * `state=undefined` in the URL. That does not fail here — it fails on the way
 * BACK, as `state_mismatch`, two steps and one provider site later, and reads
 * as "the connection expired" to someone whose connection never started.
 *
 * The mint either produced a usable state and a place to send them, or it
 * failed. There is no third answer worth acting on.
 */
function usable(body: unknown): body is PreparedConnect {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Partial<PreparedConnect>;
  return typeof candidate.state === 'string' && candidate.state.length > 0
    && typeof candidate.redirectUri === 'string' && candidate.redirectUri.length > 0;
}

/**
 * Build the `prepareConnect` a host hands to `PaymentProviderSettings`.
 *
 * The environment is echoed back only when the answer names one this package
 * knows. The SERVER is the authority on it — it is what sealed the cookie — so
 * an unrecognised value is dropped rather than argued with, and the caller
 * keeps the environment it asked for.
 */
export function createConnectPreparer(options: ConnectPreparerOptions): PrepareConnect {
  return async (provider, environment) => {
    const response = await fetch(options.prepareUrl(provider, environment), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error(options.mintFailed);

    const body: unknown = await response.json().catch(() => null);
    if (!usable(body)) throw new Error(options.mintFailed);

    return {
      state: body.state,
      redirectUri: body.redirectUri,
      environment: ENVIRONMENTS.includes(body.environment as PaymentEnvironment)
        ? body.environment
        : undefined,
    };
  };
}
