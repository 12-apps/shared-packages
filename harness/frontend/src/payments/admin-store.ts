/**
 * THE MERCHANT ADMIN STORE — a whole settings backend, in the harness browser,
 * with no server running (FUT-743's arrangement, pointed at the other side of
 * the till).
 *
 * A page mounts the real `PaymentProviderSettings` over the real
 * `createPaymentsSettingsClient`, whose `fetchImpl` routes into a real
 * `mountPayments` dispatcher over `createSettingsService` +
 * `createOAuthConnectService` + a `createMemoryProviderConfigStore`. What is
 * fictional is only the provider at the far end (see `./admin-adapter.ts`).
 *
 * This file is ASSEMBLY ONLY: the ports live in `./admin-ports.ts`, the host
 * route extensions in `./admin-extensions.ts`, the seeding in
 * `./admin-seed.ts`, and the shared transport in `./wire.ts`.
 */
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryProviderConfigStore,
  createMemoryWebhookInbox,
  createOAuthConnectService,
  createPaymentsGateway,
  createPaymentsHttp,
  createSettingsService,
  credentialStoreFrom,
  defineProviders,
  mountPayments,
  type MemoryChargeStore,
  type MerchantFailoverPolicy,
  type PaymentsGateway,
  type PaymentsIntentKind,
  type PaymentsRouteMethod,
  type ProviderConfigStore,
  type ProviderRegistry,
  type SettingsService,
} from '@12-apps/payments-backend';
import {
  createPaymentsSettingsClient,
  type PaymentProviderSettingsProps,
  type PaymentsSettingsClient,
} from '@12-apps/payments-frontend';

import { MERCHANT } from './adapter';
import { adminAdapter, type AdminProvider } from './admin-adapter';
import { activationVerifyFor, connectPrepareFor, oauthCallbackFor } from './admin-extensions';
import {
  appCredentialsFor,
  onRevokeFailure,
  prepareConnectFor,
  requireAuthFor,
  resolveChargeRequest,
  setupContextFor,
  type AdminCaller,
} from './admin-ports';
import { seedStages } from './admin-seed';
import { notifier, recordingTransport, type WireRequest } from './wire';

/** The host's half of the connect handshake, as the published props type it. */
export type PrepareConnect = NonNullable<PaymentProviderSettingsProps['prepareConnect']>;

/** Where one provider's stored row starts a case — see `./admin-seed.ts`. */
export type AdminStage =
  | 'fresh'
  | 'saved'
  | 'connected'
  | 'proven'
  | 'oauth-connected'
  | 'expiring'
  | 'reconnect-required';

/** The whole store a merchant-settings case is set in. */
export interface AdminStoreSpec {
  /**
   * The fictional cast for this case, in catalog order. Each entry is an
   * `AdminProvider` declaration that `adminAdapter` turns into a real adapter.
   * Ignored when `registry` is supplied.
   */
  providers?: AdminProvider[];
  /**
   * A registry the CASE built itself.
   *
   * Exists for exactly one caller: `pages/payments-provider-settings.tsx`,
   * which must mount the four REAL vendor adapters and is the only page file
   * the portability gate lets spell a vendor name. It builds
   * `defineProviders({...})` at module scope and hands the result in, so the
   * mount wiring below stays in one place instead of being reimplemented
   * inside the page — a second copy of the very seam the harness exists to
   * test, and a `quality:dup` clone besides.
   */
  registry?: ProviderRegistry;
  /** Per-provider stored state. A provider absent from this map is `fresh`. */
  stages?: Record<string, AdminStage>;
  /** Rows to enable, in priority order. Applied via `store.setProviderPriorities`. */
  chain?: string[];
  failoverPolicy?: MerchantFailoverPolicy;
  /** Built-in intents this case's mount must NOT serve, beyond the standing set. */
  exclude?: PaymentsIntentKind[];
  /** Providers for which `appCredentialsFor` answers null. */
  unregisteredApps?: string[];
  /** Intents `requireAuth` refuses, and with what. See `requireAuthFor`. */
  refuse?: { kind: PaymentsIntentKind; status: number; whenEnabled?: boolean };
  /** Distinct per case — the client's baseUrl AND the localStorage ack scope. */
  baseUrl: string;
}

/** The mutable half of the world — what adapters, ports and extensions write. */
export interface AdminSinks {
  /** Every request the published client (or a host control) put on the wire. */
  requests: WireRequest[];
  /** CSRF states the prepare extension minted, in order. */
  mintedStates: string[];
  /** States the callback extension was handed, echoed before the comparison. */
  consumedStates: string[];
  /** Every credential probe an adapter received. */
  verifyCalls: { provider: string; environment: string }[];
  /** Every ACTIVATION charge an adapter received (FUT-689), as it landed. */
  activationCharges: { provider: string; reference: string; token: string; status: string }[];
  /** Every refund an adapter was asked for — the cent coming back. */
  activationRefunds: string[];
  /** Providers whose revoke failed — the `RevokeFailureReporter` sink. */
  revokeFailures: string[];
  /** Every code an adapter's `exchangeCode` was asked to spend. */
  exchanges: { provider: string; code: string }[];
  /** `push:<slug>` / `replace:<slug>` — every `onProviderChange` call. */
  nav: string[];
  /** Resolvers for verify probes a `deferred` adapter is holding open. */
  heldVerifies: (() => void)[];
  /** Fires whenever any of the above grows, so a probe can re-render. */
  fire(): void;
  subscribe(listener: () => void): () => void;
}

/** What a page gets back: the published client, its wire, and server truth. */
export interface AdminWorld extends AdminSinks {
  /** Hand this to `PaymentProviderSettings`. */
  client: PaymentsSettingsClient;
  /** The transport into the mount — host controls issue raw requests here. */
  fetchImpl: typeof fetch;
  /** The host's connect handshake: `POST {base}/oauth/prepare/{p}` on the wire. */
  prepareConnect: PrepareConnect;
  /** The host's OAuth callback route, `POST {base}/oauth/callback/{p}`. */
  postCallback(
    provider: string,
    body: { code: string; state: string; redirectUri: string; environment?: 'SANDBOX' | 'PRODUCTION' },
  ): Promise<Response>;
  /** Server truth for the probe — the published service, read in-process. */
  settings: SettingsService;
  /** The ONE db port behind everything; the probe reads token blobs off it. */
  store: ProviderConfigStore;
  registry: ProviderRegistry;
  baseUrl: string;
  /** Release every verify probe a `deferred` adapter is holding open. */
  releaseVerify(): void;
}

/**
 * Intents NO admin mount serves, whatever the case says:
 *
 *   - `completeOAuth` — the callback is a HOST route (the CSRF comparison
 *     happens where the session lives); a mount serving it would let a spec
 *     pass while the path every host actually ships was broken. Canonical per
 *     `MountPaymentsOptions.exclude`'s own doc.
 *   - the charge surface — an admin world never charges, which is what makes
 *     `resolveChargeRequest` a thrower rather than a liability.
 *
 * A case's own `exclude` NARROWS further (the catalog page leaves only
 * `getSettings` + `getSetupGuide` standing); nothing re-opens these.
 */
const ADMIN_EXCLUDED: readonly PaymentsIntentKind[] = [
  'completeOAuth',
  'createCharge',
  'getCharge',
  'handleWebhook',
  'getClientConfig',
];

function excludedIntents(spec: AdminStoreSpec): PaymentsIntentKind[] {
  return [...new Set<PaymentsIntentKind>([...ADMIN_EXCLUDED, ...(spec.exclude ?? [])])];
}

function createSinks(): AdminSinks {
  const { fire, subscribe } = notifier();
  return {
    requests: [],
    mintedStates: [],
    consumedStates: [],
    verifyCalls: [],
    activationCharges: [],
    activationRefunds: [],
    revokeFailures: [],
    exchanges: [],
    nav: [],
    heldVerifies: [],
    fire,
    subscribe,
  };
}

/** The charge engine both mounts sit on — unreachable here, but real. */
function adminGateway(
  registry: ProviderRegistry,
  store: ProviderConfigStore,
  charges: MemoryChargeStore,
): PaymentsGateway {
  return createPaymentsGateway({
    providers: registry,
    // The published bridge, not a second credential store: one storage
    // implementation powers both the settings page and the charge path.
    credentials: credentialStoreFrom(store, { allowStubMode: true }),
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
}

/**
 * Build the store. `ready` is the seeding promise — `AdminSettings` gates the
 * mount on it, because the `reconnect-required` stage goes through the
 * published `oauth.refresh` and must land before the first `GET /settings`.
 */
export function createAdminStore(spec: AdminStoreSpec): { world: AdminWorld; ready: Promise<void> } {
  const sinks = createSinks();
  const registry =
    spec.registry ??
    defineProviders(
      Object.fromEntries((spec.providers ?? []).map((entry) => [entry.name, adminAdapter(entry, sinks)])),
    );
  const store = createMemoryProviderConfigStore();
  const settings = createSettingsService(registry, store, { allowStubMode: true });
  const oauth = createOAuthConnectService(registry, store, appCredentialsFor(spec), onRevokeFailure(sinks));
  const ready = seedStages(store, oauth, registry, MERCHANT, spec); // AFTER `oauth` exists
  const charges = createMemoryChargeStore();
  const http = createPaymentsHttp({
    gateway: adminGateway(registry, store, charges),
    settings,
    charges,
    oauth,
    resolveChargeRequest,
    setupContextFor: setupContextFor(store, registry),
  });
  // `prefix: []` — the WHOLE canonical table under one dispatcher, so
  // `LIBRARY_ROUTES` is exercised as published rather than as one host
  // happened to slice it, and every path the settings client composes is
  // served by the mount. It also gives the two host extensions somewhere to
  // live that is not under `settings/providers`.
  const routes = mountPayments<AdminCaller>({
    gateway: http,
    requireAuth: requireAuthFor(spec),
    resolveMerchant: () => MERCHANT,
    prefix: [],
    exclude: excludedIntents(spec),
    extensions: [
      connectPrepareFor(sinks, spec),
      oauthCallbackFor(sinks, oauth),
      // The activation charge is a HOST route in every real deployment too —
      // the charge intents stay excluded; only this extension reaches the
      // adapter's activation half, in-process (FUT-689).
      activationVerifyFor(sinks, { registry, store, settings }),
    ],
  });
  const fetchImpl = recordingTransport<PaymentsRouteMethod>(routes, {
    baseUrl: spec.baseUrl,
    requests: sinks.requests,
    fire: sinks.fire,
  }) as typeof fetch;
  const world: AdminWorld = {
    ...sinks,
    baseUrl: spec.baseUrl,
    registry,
    store,
    settings,
    fetchImpl,
    client: createPaymentsSettingsClient({ baseUrl: spec.baseUrl, fetchImpl }),
    prepareConnect: prepareConnectFor(fetchImpl, spec.baseUrl),
    postCallback: (provider, body) =>
      fetchImpl(`${spec.baseUrl}/oauth/callback/${provider}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    releaseVerify: () => {
      sinks.heldVerifies.splice(0).forEach((release) => release());
      sinks.fire();
    },
  };
  return { world, ready };
}
