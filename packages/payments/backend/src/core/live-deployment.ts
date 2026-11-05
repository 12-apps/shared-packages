import type { CredentialStore } from './credential-store';
import type { PaymentProviderAdapterBase } from './provider';
import { CredentialsError } from './errors';
import type { ProviderRegistry } from './registry';
import type { MerchantRef, PaymentEnvironment, ProviderName } from './types';

/**
 * A SIMULATED-sandbox connection takes no buyer's money on a LIVE deployment.
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

/**
 * The process environment this policy reads `PAYMENTS_LIVE_DEPLOYMENT` from.
 * An index signature rather than one optional key: a type with only optional
 * keys is weak, and TS refuses a bare `process.env` against it (TS2559). The
 * host passes the live object so every call reads it afresh.
 */
export interface LiveDeploymentEnv {
  readonly [name: string]: string | undefined;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** Whether this environment marks the deployment as live. Absent or anything else: not live. */
export function readLiveDeployment(env: LiveDeploymentEnv): boolean {
  return TRUTHY.has((env.PAYMENTS_LIVE_DEPLOYMENT ?? '').trim().toLowerCase());
}

/**
 * THE rule, as one pure predicate: on a live deployment, a connection in its
 * provider's SIMULATED sandbox (`PaymentProviderAdapterBase.simulatedSandbox`)
 * takes no buyer's money. Routing asks it of the resolved credentials
 * (`liveOnlyCredentials`); the settings view asks it of the stored row, so the
 * screen says what checkout does.
 */
export function refusesSimulatedSandbox(
  adapter: Pick<PaymentProviderAdapterBase, 'simulatedSandbox'>,
  environment: PaymentEnvironment,
  live: boolean,
): boolean {
  return live && adapter.simulatedSandbox === true && environment === 'SANDBOX';
}

/** Whether this provider's SANDBOX is a simulator at all — no read needed when it is not. */
function sandboxIsSimulated(providers: ProviderRegistry, name: ProviderName): boolean {
  return providers.has(name) && providers.get(name).simulatedSandbox === true;
}

/**
 * Whether this chain entry routes to a SIMULATED sandbox. Asked only of an
 * adapter that declares one, so no other entry pays a credential read. A row
 * that is not connected (null) or refused as such (`CredentialsError`) cannot
 * be routed to anyway and is left out; any other failure PROPAGATES, exactly
 * as the gateway's own chain read lets it (FUT-4072) — a store whose
 * credentials cannot be read must fail loudly, not quietly sell less.
 */
async function routesToSimulatedSandbox(
  inner: CredentialStore,
  providers: ProviderRegistry,
  merchant: MerchantRef,
  name: ProviderName,
): Promise<boolean> {
  if (!sandboxIsSimulated(providers, name)) return false;
  try {
    const credentials = await inner.getCredentials(merchant, name);
    return credentials === null || refusesSimulatedSandbox(providers.get(name), credentials.environment, true);
  } catch (error) {
    if (error instanceof CredentialsError) return true;
    throw error;
  }
}

/** The chain without the entries that route to a simulated sandbox, in order. */
async function withoutSimulatedSandboxes(
  inner: CredentialStore,
  providers: ProviderRegistry,
  merchant: MerchantRef,
  chain: readonly ProviderName[],
): Promise<ProviderName[]> {
  const dropped = await Promise.all(chain.map((name) => routesToSimulatedSandbox(inner, providers, merchant, name)));
  return chain.filter((_, index) => !dropped[index]);
}

/**
 * The credential store with every connection that routes to a SIMULATED
 * sandbox taken out of the merchant's ROUTING while the environment marks the
 * deployment live — read per call, so the answer follows the environment
 * rather than the moment the store was built.
 *
 * SIMULATED is the adapter's own declaration (`simulatedSandbox`), never the
 * stored column alone: a provider with one host for both modes, or one whose
 * key picks test or live, can hold a row stored as SANDBOX that takes real
 * money, and that store must keep selling.
 *
 * Only routing moves: `providerChain`, and `defaultProvider` as its head. Those
 * are what the buyer's surfaces ask — the gateway's `clientConfigChain` (and so
 * `buyerCheckoutConfig`, which then carries no method, no key and no wallet
 * from that connection), the charge walk (which then never sends a charge to
 * it), and a host's "are payments configured at all" check. A store whose
 * every connection is such a sandbox therefore reads exactly like a store with
 * none connected, and gets the refusal and the empty state that already exist
 * for that.
 *
 * Credential reads by NAME are untouched: inbound webhooks, reconciliation and
 * whatever a host resolves for a named provider keep working, because money
 * that already moved still has to be heard.
 *
 * Not live: the store itself, unchanged.
 */
export function liveOnlyCredentials(
  inner: CredentialStore,
  processEnv: LiveDeploymentEnv,
  providers: ProviderRegistry,
): CredentialStore {
  const live = (): boolean => readLiveDeployment(processEnv);
  const providerChain = async (merchant: MerchantRef): Promise<ProviderName[]> => {
    const chain = await inner.providerChain(merchant);
    return live() ? withoutSimulatedSandboxes(inner, providers, merchant, chain) : chain;
  };
  return {
    ...inner,
    providerChain,
    defaultProvider: async (merchant) => {
      if (!live()) return inner.defaultProvider(merchant);
      return (await providerChain(merchant))[0] ?? null;
    },
  };
}
