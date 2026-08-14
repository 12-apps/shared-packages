/**
 * A whole MERCHANT SETTINGS backend, in a browser tab, with no server running
 * — `store.ts`'s sibling for the other side of the till.
 *
 * ## Why this is not a mock
 *
 * Every state the settings page shows is computed SERVER-side: the masked
 * hints, the status vocabulary, the failover chain, what a save invalidates,
 * what a probe is allowed to persist. So every story runs the REAL
 * `createSettingsService` behind the REAL `createPaymentsHttp` handlers and
 * the REAL `mountPayments` route table, reached through a `fetch` handed to
 * `createPaymentsSettingsClient` — the bytes that cross are the bytes the
 * shipped admin sends. What is faked is only what a browser genuinely cannot
 * have: the merchant's stored rows, and the providers at the far end of them
 * (`settings-store-adapter.ts`).
 *
 * ## No vendor subpaths
 *
 * Only `@12-apps/payments-backend`'s ROOT entry is imported. The adapter
 * subpaths (`./providers/*`) reach for `node:crypto` and would not survive
 * bundling; see `settings-store-adapter.ts` for the local stand-ins.
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
  type MemoryProviderConfigStore,
  type MerchantFailoverPolicy,
  type PaymentsHttpHandlers,
  type ProviderRegistry,
  type SetupProgress,
  type StoredProviderConfig,
} from "@12-apps/payments-backend";

import {
  oauthExpiryOf,
  seededCredentialFields,
  settingsAdapter,
  type SettingsStoryProvider,
} from "./settings-store-adapter";
import { MERCHANT } from "./store-adapter";

/** The store the settings page is set at. */
export interface SettingsStorySpec {
  /** The catalog. Default: one fresh credentials-mode provider. */
  providers?: SettingsStoryProvider[];
  /**
   * The failover chain in priority order. Defaults to every enabled provider
   * in declaration order; name only providers whose stage put them in the
   * chain.
   */
  chain?: string[];
  /** Whether a declined card cascades to the next acquirer. Default: TECHNICAL. */
  failoverPolicy?: MerchantFailoverPolicy;
  /**
   * Whether THIS deployment grants SANDBOX stub mode (default true, like local
   * dev). It reaches everything the real flag reaches: what a save stamps on
   * the row, and whether "Testar conexão" short-circuits — every adapter
   * (these included) answers `{ ok: true, 'stub mode' }` the moment `stub` is
   * set, so a story about a probe that FAILS must declare `false` or its
   * pinned outcome is unreachable in the configuration it runs.
   */
  allowStubMode?: boolean;
}

/** What a story gets back: the transport over the in-page mount. */
interface SettingsStoryWorld {
  /** Hand this to `createPaymentsSettingsClient({ baseUrl, fetchImpl })`. */
  fetchImpl: typeof fetch;
}

/**
 * The merchant-scoped prefix the shipped admin mounts one client per store on
 * (`/api/admin/<slug>/payments`). Kept in that shape so the wire the stories
 * drive is the wire future-pay drives — and because `baseUrl` is the key the
 * components scope their per-store browser state on (the setup confirmation).
 */
export const SETTINGS_BASE_URL = "/api/admin/loja-1/payments";

/** Fixed timestamps, so the seeded history reads the same on every render. */
const PROBE_PASSED_AT = new Date("2026-07-20T15:00:00.000Z");
const CHARGE_LANDED_AT = new Date("2026-07-21T10:30:00.000Z");

/** Which stages sit in the chain, unless the story says otherwise. */
function enabledFor(provider: SettingsStoryProvider): boolean {
  if (provider.enabled !== undefined) return provider.enabled;
  const stage = provider.stage ?? "fresh";
  // `reconnect` stays enabled on purpose: the GRANT died, nobody switched the
  // provider off — which is exactly why the published chain must route around
  // it (`inRotation`) rather than trust `enabled`.
  return stage === "proven" || stage === "reconnect";
}

/**
 * The merchant's stored connection for one declared provider — the thing a
 * browser genuinely cannot have, and (with the adapters) the ONLY thing a
 * settings story fakes. Everything read back OUT of it goes through the real
 * service: the masking, the chain, the badge vocabulary.
 */
function rowFor(
  provider: SettingsStoryProvider,
  rank: number,
  allowStub: boolean,
): StoredProviderConfig {
  const stage = provider.stage ?? "fresh";
  const environment = provider.environment ?? "SANDBOX";
  return {
    provider: provider.name,
    enabled: enabledFor(provider),
    priority: Math.max(rank, 0),
    environment,
    status: stage === "reconnect" ? "RECONNECT_REQUIRED" : "VERIFIED",
    lastVerifiedAt: PROBE_PASSED_AT,
    // `proven` rows carry the money proof, and `chargeProven` carries it into
    // any other stage — the proof PERSISTS on the row, which is what lets the
    // VERIFICADO badge outrank every stored status the moment it exists.
    chargeVerifiedAt:
      stage === "proven" || provider.chargeProven ? CHARGE_LANDED_AT : null,
    pendingVerification: null,
    expiresAt: oauthExpiryOf(provider),
    // Exactly what `applySaveCredentials` would have stamped: stub mode is
    // derived, never seeded free-hand — on only where the deployment allows it
    // AND the active environment is SANDBOX, so a PRODUCTION row (or a
    // stub-refusing deployment) never carries a grant the backend cannot mint.
    stub: allowStub && environment === "SANDBOX",
    environments: {
      SANDBOX: environment === "SANDBOX" ? seededCredentialFields(provider) : {},
      PRODUCTION: environment === "PRODUCTION" ? seededCredentialFields(provider) : {},
    },
  };
}

/**
 * Async, and AWAITED by the transport before it routes anything: the memory
 * store happens to answer synchronously today, but the seeding contract must
 * not depend on that — a store that settled a tick later would otherwise serve
 * the page its first read out of an empty merchant, silently.
 */
async function seedSettings(
  spec: SettingsStorySpec,
  catalog: readonly SettingsStoryProvider[],
  connections: MemoryProviderConfigStore,
): Promise<void> {
  const chain = spec.chain ?? catalog.filter(enabledFor).map((provider) => provider.name);
  for (const provider of catalog) {
    if ((provider.stage ?? "fresh") === "fresh") continue;
    await connections.save(
      MERCHANT,
      rowFor(provider, chain.indexOf(provider.name), spec.allowStubMode ?? true),
    );
  }
  if (spec.failoverPolicy) await connections.setFailoverPolicy(MERCHANT, spec.failoverPolicy);
}

/**
 * What this store has already done, read from the SAME rows the page renders
 * — future-pay's `setupProgressFor`, story-sized. It is what makes a guide
 * open on a later step when a story seeds a further stage.
 */
async function progressFor(
  connections: MemoryProviderConfigStore,
  provider: string,
): Promise<SetupProgress> {
  const config = await connections.get(MERCHANT, provider);
  if (!config) return { configured: {}, connected: false, proven: false };
  const fields = config.environments[config.environment] ?? {};
  return {
    configured: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value.length > 0]),
    ),
    connected: config.status === "VERIFIED" || config.status === "RECONNECT_REQUIRED",
    proven: config.chargeVerifiedAt !== null,
  };
}

/**
 * The HTTP surface over the real domain services — the same
 * `createPaymentsHttp` composition future-pay's `gateway.ts` builds, with the
 * memory stores standing in for Prisma.
 */
function settingsHttp(
  registry: ProviderRegistry,
  connections: MemoryProviderConfigStore,
  allowStubMode: boolean,
): PaymentsHttpHandlers {
  // `allowStubMode` is the deployment decision local dev makes (SANDBOX-only
  // deterministic fakes, refused for PRODUCTION); a story is that deployment,
  // and may declare the stricter one (`spec.allowStubMode: false`) when its
  // subject is a probe that must actually run.
  const settings = createSettingsService(registry, connections, { allowStubMode });
  const charges = createMemoryChargeStore();
  const gateway = createPaymentsGateway({
    providers: registry,
    // One storage implementation powers both the settings page and the charge
    // path — the same bridge production uses.
    credentials: credentialStoreFrom(connections, { allowStubMode }),
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
  // The PLATFORM's application credentials — shared across merchants and
  // host-supplied, which is what lets a story's connect button answer at all.
  const oauth = createOAuthConnectService(registry, connections, (_provider, environment) => ({
    environment,
    fields: { clientId: "app-plataforma-exemplo", clientSecret: "segredo-plataforma" },
  }));
  return createPaymentsHttp({
    gateway,
    settings,
    charges,
    oauth,
    // The merchant surface never raises a charge; the buyer mount
    // (`store.ts`) owns that side of the till.
    resolveChargeRequest: () => {
      throw new Error("settings stories never charge");
    },
    setupContextFor: async (_merchant, provider) => ({
      brandName: "Plataforma Exemplo",
      webhookUrl: `https://loja.exemplo/api/payments/webhooks/${provider}`,
      merchantName: "Loja Exemplo",
      storefrontUrl: "https://loja.exemplo/cardapio",
      progress: await progressFor(connections, provider),
    }),
  });
}

/**
 * Build the store. Everything below the `fetch` is real: the registry, the
 * settings service (masking, the enablement gates, the probe's persistence
 * rule), the OAuth connect service, the HTTP handlers and the canonical route
 * table are the shipped ones.
 */
export function createSettingsStoryStore(spec: SettingsStorySpec = {}): SettingsStoryWorld {
  const catalog = spec.providers ?? [{ name: "aurora" }];
  const registry = defineProviders(
    Object.fromEntries(catalog.map((entry) => [entry.name, settingsAdapter(entry)])),
  );
  const connections = createMemoryProviderConfigStore();
  const seeded = seedSettings(spec, catalog, connections);

  // The same mount future-pay's admin catch-all builds: host auth first, then
  // merchant attribution, then the one handler the intent names.
  // `completeOAuth` is excluded exactly as it is there — only a
  // state-validating callback may spend an authorization code, and a story
  // has none.
  const routes = mountPayments<{ id: string }>({
    gateway: settingsHttp(registry, connections, spec.allowStubMode ?? true),
    requireAuth: () => ({ id: "dona-1" }),
    resolveMerchant: () => MERCHANT,
    exclude: ["completeOAuth"],
  });

  const call = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // No request is answered out of a half-seeded merchant: the memory store
    // is synchronous today, but that is an implementation detail, not the
    // contract this transport gets to rely on.
    await seeded;
    // Named anything but `path`: a local called `path` reads as `node:path` to
    // the flakiness gate's unmocked-fs rule (same note as `store.ts`).
    const target = String(input);
    const [route = "", query] = target.replace(SETTINGS_BASE_URL, "").split("?");
    const url = `https://loja.exemplo${SETTINGS_BASE_URL}${route}${query ? `?${query}` : ""}`;
    const verb = (init?.method ?? "GET") as "GET" | "POST" | "PUT";
    return routes[verb](new Request(url, init as RequestInit), {
      params: { segments: route.split("/").filter(Boolean) },
    });
  };

  return { fetchImpl: call as typeof fetch };
}
