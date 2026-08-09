/**
 * The HEADLESS CLIENT's store: the `mountPayments` charge surface, in a
 * browser tab, with no server running — `store.ts`'s sibling for the OTHER
 * buyer-side wire.
 *
 * ## Why a third store
 *
 * `store.ts` serves the FUT-741 checkout mount (`createPaymentFlowsBE`:
 * `/config`, `/charge`, `/status`, …). The headless client and everything
 * built on it — `createPaymentsClient`, `PaymentsProvider` + its hooks,
 * `CheckoutPayment` — predate that mount and speak a DIFFERENT published
 * wire: `GET /config`, `POST /charges`, `GET /charges/:provider/:chargeId`
 * on the host's `mountPayments` prefix. A story about them therefore runs
 * the REAL `createPaymentsHttp` handlers behind the REAL `mountPayments`
 * route table, reached through a `fetch` handed to `createPaymentsClient` —
 * the bytes that cross are the bytes a deployed host serves. What is faked
 * is only what a browser genuinely cannot have: the merchant's stored
 * credentials, and the provider at the far end of them (`store-adapter.ts`,
 * the same fictional adapters every other story runs on).
 *
 * ## No vendor subpaths
 *
 * Only `@12-apps/payments-backend`'s ROOT entry is imported. The adapter
 * subpaths (`./providers/*`) reach for `node:crypto` and would not survive
 * bundling; see `store-adapter.ts` for the local stand-ins.
 */
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  createMemoryWebhookInbox,
  createPaymentsGateway,
  createPaymentsHttp,
  createSettingsService,
  defineProviders,
  mountPayments,
  type ChargeInput,
} from "@12-apps/payments-backend";

import { BRL, MERCHANT, storyAdapter, type StoryProvider } from "./store-adapter";

/** The store a headless-client story is set at. */
export interface ClientStorySpec {
  /** The failover chain. Default: one stub provider that takes PIX and card. */
  chain?: StoryProvider[];
  /** What the host's one open order costs. Default R$ 75,00. */
  amountCents?: number;
}

/**
 * What a story gets back: the transport over the in-page mount. Not exported:
 * unlike `StoryWorld`/`SettingsStoryWorld` no story names this type —
 * consumers destructure straight off `createClientStoryStore(...)`.
 */
interface ClientStoryWorld {
  /** Hand this to `createPaymentsClient({ baseUrl: CLIENT_BASE_URL, fetchImpl })`. */
  fetchImpl: typeof fetch;
}

/**
 * The host prefix the client is bound to — the example `PaymentsClientOptions`
 * itself documents (`/api/payments`), kept verbatim so the URLs the stories
 * drive are the URLs a shipped host mounts.
 */
export const CLIENT_BASE_URL = "/api/payments";

/**
 * The merchant's stored credentials — appended in chain order, so declaration
 * order IS the routing order, exactly as `store.ts` seeds its mount.
 */
function seedCredentials(
  chain: readonly StoryProvider[],
  credentials: ReturnType<typeof createMemoryCredentialStore>,
): void {
  for (const entry of chain) {
    credentials.set(MERCHANT, entry.name, {
      environment: "SANDBOX",
      fields: entry.publicKey ? { publicKey: entry.publicKey } : {},
      stub: entry.stub ?? false,
    });
  }
}

/**
 * Build the store. Everything below the `fetch` is real: the gateway, the
 * failover walk, the charge handlers, the client-safe projections and the
 * canonical route table are the shipped ones.
 */
export function createClientStoryStore(spec: ClientStorySpec = {}): ClientStoryWorld {
  const chain = spec.chain ?? [{ name: "aurora", stub: true, publicKey: null }];
  // The adapter records what it received; nothing here reads the log back —
  // it exists because `storyAdapter`'s contract asks for the sink.
  const seen: ChargeInput[] = [];
  const registry = defineProviders(
    Object.fromEntries(chain.map((entry) => [entry.name, storyAdapter(entry, seen)])),
  );
  const credentials = createMemoryCredentialStore();
  seedCredentials(chain, credentials);
  const charges = createMemoryChargeStore();
  const gateway = createPaymentsGateway({
    providers: registry,
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });

  const http = createPaymentsHttp({
    gateway,
    // Required by the surface, driven by no story here: the settings half of
    // this mount has its own store (`settings-store.ts`). An empty one keeps
    // the composition the shipped one without seeding rows nobody reads.
    settings: createSettingsService(registry, createMemoryProviderConfigStore(), {
      allowStubMode: true,
    }),
    charges,
    resolveChargeRequest: async (_merchant, draft) => ({
      // The HOST's half of the money rule: the browser named an order, the
      // server answers what it costs. The draft cannot even carry an amount
      // or a reference — this host has exactly one open order to resolve to.
      reference: draft.orderRef ?? "pedido-0043",
      amount: BRL(spec.amountCents ?? 7500),
      method: draft.method,
      customer: { name: "Ana Compradora", email: "ana@exemplo.com", ...draft.customer },
      card: draft.card,
      pix: draft.pix,
    }),
  });

  // The same mount a host's catch-all builds: host auth first, then merchant
  // attribution, then the one handler the intent names.
  const routes = mountPayments<{ id: string }>({
    gateway: http,
    requireAuth: () => ({ id: "compradora-1" }),
    resolveMerchant: () => MERCHANT,
  });

  const call = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Named anything but `path`: a local called `path` reads as `node:path` to
    // the flakiness gate's unmocked-fs rule (same note as `store.ts`).
    const target = String(input);
    const [route = "", query] = target.replace(CLIENT_BASE_URL, "").split("?");
    const url = `https://loja.exemplo${CLIENT_BASE_URL}${route}${query ? `?${query}` : ""}`;
    const verb = (init?.method ?? "GET") as "GET" | "POST" | "PUT";
    return routes[verb](new Request(url, init as RequestInit), {
      params: { segments: route.split("/").filter(Boolean) },
    });
  };

  return { fetchImpl: call as typeof fetch };
}
