import type { CredentialStore } from './credential-store';
import type { MerchantRef, ProviderName } from './types';

/**
 * A SANDBOX connection takes no buyer's money on a LIVE deployment.
 *
 * A connection starts in SANDBOX (`config/connect-state.ts` defaults every
 * unclear answer to it), and on a deployment that serves real buyers a store
 * that never switched offered card, Pix and wallets against the provider's
 * sandbox: the buyer "paid", nobody was charged, and the order could still
 * move as if it had been. Every OTHER deployment — a laptop, an e2e run, a
 * review box, the homologação evidence run — exists to run exactly that
 * sandbox, so the rule cannot be keyed on `NODE_ENV`, which review boxes set
 * to `production` too.
 *
 * So it is an explicit switch, `PAYMENTS_LIVE_DEPLOYMENT`, that only the live
 * deployment's own configuration sets; absent means NOT live, and sandbox
 * keeps working everywhere it works today.
 */

/** The one environment variable that marks the deployment as live. */
export const LIVE_DEPLOYMENT_ENV_VAR = 'PAYMENTS_LIVE_DEPLOYMENT';

/** The slice of the process environment this policy reads. */
export interface LiveDeploymentEnv {
  PAYMENTS_LIVE_DEPLOYMENT?: string | undefined;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** Whether this environment marks the deployment as live. Absent or anything else: not live. */
export function readLiveDeployment(env: LiveDeploymentEnv): boolean {
  return TRUTHY.has((env.PAYMENTS_LIVE_DEPLOYMENT ?? '').trim().toLowerCase());
}

/** The chain entries whose ROUTED credentials are PRODUCTION; a read that throws keeps nothing. */
async function productionOnly(
  inner: CredentialStore,
  merchant: MerchantRef,
  chain: readonly ProviderName[],
): Promise<ProviderName[]> {
  const environments = await Promise.all(
    chain.map((name) =>
      inner.getCredentials(merchant, name).then(
        (credentials) => credentials?.environment ?? null,
        () => null,
      ),
    ),
  );
  return chain.filter((_, index) => environments[index] === 'PRODUCTION');
}

/**
 * The credential store with every SANDBOX connection taken out of the
 * merchant's ROUTING while `env` marks the deployment live — read per call, so
 * the answer follows the environment rather than the moment the store was
 * built.
 *
 * Only routing moves: `providerChain`, and `defaultProvider` as its head. Those
 * are what the buyer's surfaces ask — the gateway's `clientConfigChain` (and so
 * `buyerCheckoutConfig`, which then carries no method, no key and no wallet
 * from that connection), the charge walk (which then never sends a charge to
 * it), and a host's "are payments configured at all" check. A store whose
 * every connection is sandbox therefore reads exactly like a store with none
 * connected, and gets the refusal and the empty state that already exist for
 * that.
 *
 * Credential reads by NAME are untouched: inbound webhooks, reconciliation and
 * whatever a host resolves for a named provider keep working, because money
 * that already moved still has to be heard.
 *
 * Not live: the store itself, unchanged.
 */
export function liveOnlyCredentials(inner: CredentialStore, env: LiveDeploymentEnv): CredentialStore {
  const providerChain = async (merchant: MerchantRef): Promise<ProviderName[]> => {
    const chain = await inner.providerChain(merchant);
    return readLiveDeployment(env) ? productionOnly(inner, merchant, chain) : chain;
  };
  return {
    ...inner,
    providerChain,
    defaultProvider: async (merchant) => {
      if (!readLiveDeployment(env)) return inner.defaultProvider(merchant);
      return (await providerChain(merchant))[0] ?? null;
    },
  };
}
