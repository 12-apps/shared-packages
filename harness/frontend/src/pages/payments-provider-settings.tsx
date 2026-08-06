import { defineProviders } from '@12-apps/payments-backend';
import { infinitePayProvider } from '@12-apps/payments-backend/providers/infinitepay';
import { pagbankProvider } from '@12-apps/payments-backend/providers/pagbank';
import { stoneProvider } from '@12-apps/payments-backend/providers/stone';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';
import { PaymentProviderSettings } from '@12-apps/payments-frontend';

/**
 * The composition a host actually performs: adapters registered against
 * @12-apps/payments-backend, rendered by @12-apps/payments-frontend — both
 * installed from their published tarballs, neither reachable as a workspace
 * sibling.
 *
 * Nothing here is a mock of OUR code. The registry, the adapters and the
 * settings page are the real published ones; only the transport is replaced,
 * because a merchant's stored credentials are the host's half of the contract
 * and belong to the backend harness, not this one.
 */
const registry = defineProviders({
  pagbank: pagbankProvider(),
  stone: stoneProvider(),
  infinitepay: infinitePayProvider(),
  stripe: stripeProvider(),
});

// The same projection the backend's settings service performs — every field
// read off the adapter itself, so a descriptor the adapters stop supplying
// shows up here as a card that fails to render rather than as a green test.
const providers = registry.names.map((name) => {
  const adapter = registry.get(name);
  return {
    name: adapter.name,
    displayName: adapter.displayName,
    urlSlug: registry.urlSlugOf(adapter.name),
    capabilities: adapter.capabilities,
    authMode: adapter.authMode ?? 'credentials',
    credentialSchema: adapter.credentialSchema,
  };
});

const view = {
  providers,
  configs: [],
  providerChain: [],
  activeProvider: null,
  failoverPolicy: 'TECHNICAL',
};

const unsupported = (action: string) => async () => {
  throw new Error(`the frontend harness does not implement ${action} — that is the backend harness's job`);
};

const client = {
  baseUrl: '/api/harness/payments',
  getSettings: async () => view,
  saveCredentials: unsupported('saveCredentials'),
  setEnabled: unsupported('setEnabled'),
  setPriorities: unsupported('setPriorities'),
  setFailoverPolicy: unsupported('setFailoverPolicy'),
  verify: unsupported('verify'),
};

export function PaymentsProviderSettingsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the stub above
  // implements the transport surface the settings page uses; the full client type
  // also carries members only the credential flows reach.
  return <PaymentProviderSettings client={client as any} />;
}
