/**
 * A whole payable STORE, in the harness browser, with no server running
 * (FUT-743).
 *
 * ## Why this is not a mock
 *
 * FUT-740's three criticals all lived in the SEAM between the published client
 * and the published mount — a CARD charge settling a PIX payable, a `/charge`
 * body the shipped client never sends, and a CPF the payable could not carry.
 * CI was green on all fifteen checks while every one of them was live, because
 * each side tested its own half against a body it wrote itself.
 *
 * So a harness page runs a REAL `createPaymentFlowsBE` mount, in the page,
 * behind the `fetch` handed to `createPaymentFlows({ transport })`. The bytes
 * that cross are the bytes production sends, and {@link HarnessWorld.requests}
 * records them so a spec can assert on the wire rather than on our own client.
 * What is stubbed is only what a browser genuinely cannot have: the merchant's
 * stored credentials, and the provider at the other end of them.
 */
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  createMemoryWebhookInbox,
  createPaymentFlowsBE,
  createPaymentsGateway,
  defineProviders,
  type MemoryChargeStore,
  type PaymentFlowsBE,
  type MemoryCredentialStore,
  type MemoryProviderConfigStore,
  type Payable,
  type PaymentMethodKind,
} from '@12-apps/payments-backend';

import {
  BRL,
  MERCHANT,
  brlLabel,
  harnessAdapter,
  harnessCopy,
  type HarnessProvider,
  type SeenCharge,
} from './adapter';

/** The whole store a harness page is set in. */
export interface HarnessStoreSpec {
  chain?: HarnessProvider[];
  /** Instruments the buyer already has vaulted here. */
  instruments?: { id: string; last4: string; brand?: string }[];
  /**
   * Vault ids this caller OWNS but this store cannot charge (FUT-697) — the
   * "not usable here" 409, which must not read as a decline.
   */
  unusableInstruments?: string[];
  amountCents?: number;
  /** The buyer identity the payable itself carries. Never a CPF: no column. */
  customer?: { name?: string; email?: string };
  /**
   * The payable was already settled out of band — the webhook landed while the
   * buyer was on a hosted provider's page. This is what makes the RETURN leg a
   * real round trip instead of a poll against a store that forgot everything.
   */
  settled?: boolean;
}

/** One request the published client actually put on the wire. */
export interface WireRequest {
  method: string;
  /** The path as the client wrote it, prefix included — `/api/checkout/charge`. */
  path: string;
  /** The parsed JSON body, or null for a GET. */
  body: Record<string, unknown> | null;
}

/** The host's own body for a payable — echoed verbatim, never read by the library. */
interface HarnessView {
  invoice: string;
  total: number;
  totalLabel: string;
  pix?: { copyPaste: string; expiresAt: string };
  hostedCheckoutUrl?: string;
}

/** What a page gets back: the transport to hand the factory, plus the truth. */
export interface HarnessWorld {
  /** Hand this to `createPaymentFlows({ transport: { fetchImpl } })`. */
  fetchImpl: typeof fetch;
  /** Every charge the providers actually received, in order. */
  seen: SeenCharge[];
  /** Every request the published client put on the wire, in order. */
  requests: WireRequest[];
  /** Every instrument the mount asked to vault. */
  vaulted: { provider: string; token: string; display: unknown }[];
  /** Hosted destinations the navigate port was handed. */
  navigated: string[];
  /**
   * Record a hosted departure AND wake the probe.
   *
   * A plain `navigated.push` is invisible: the probe re-renders on this world's
   * own notifications, and the handover happens strictly AFTER the request that
   * raised the payable — so the last notification predates the departure and
   * the page would show `(none)` for a navigation that really occurred.
   */
  recordNavigation(url: string): void;
  /** Fires whenever any of the above grows, so a probe can re-render. */
  subscribe(listener: () => void): () => void;
  /** `POST /` — raise the payable and its first charge, over the real wire. */
  createPayable: (body: {
    method: PaymentMethodKind;
    buyer?: { name?: string; email?: string; taxId?: string; phone?: string };
  }) => Promise<Response>;
}

/**
 * The merchant's stored credentials and connections — the two things a browser
 * genuinely cannot have, and the ONLY things a page fakes.
 *
 * The STORED CONNECTION is where `mockTokenization` comes from; the credential
 * store is not consulted for it. Setting the stub flag only on the credentials
 * would publish `mockTokenization: false`, and the card form would then refuse
 * a card it has no way to mint.
 */
function seedConnections(
  chain: readonly HarnessProvider[],
  credentials: MemoryCredentialStore,
  connections: MemoryProviderConfigStore,
): void {
  for (const [rank, entry] of chain.entries()) {
    const fields: Record<string, string> = entry.publicKey ? { publicKey: entry.publicKey } : {};
    credentials.set(MERCHANT, entry.name, {
      environment: 'SANDBOX',
      fields,
      stub: entry.stub ?? false,
    });
    void connections.save(MERCHANT, {
      provider: entry.name,
      enabled: true,
      priority: rank,
      environment: 'SANDBOX',
      status: 'VERIFIED',
      lastVerifiedAt: new Date(0),
      chargeVerifiedAt: new Date(0),
      pendingVerification: null,
      expiresAt: null,
      stub: entry.stub ?? false,
      environments: { SANDBOX: fields, PRODUCTION: {} },
    });
  }
}

/**
 * The host's payable.
 *
 * `create` reads the METHOD and the BUYER off its own request body — the CPF in
 * particular, which the payable has no column for and which can therefore only
 * arrive with the request that raises it. That is FUT-740's third critical,
 * stated as a host contract rather than as a library rule.
 */
function payablesPort(world: { payable: Payable }, charges: MemoryChargeStore) {
  return {
    load: async (_caller: unknown, ref: string) =>
      ref === world.payable.ref ? world.payable : null,
    create: async (_caller: unknown, body: unknown) => {
      const draft = body as {
        method?: PaymentMethodKind;
        buyer?: { name?: string; email?: string; taxId?: string; phone?: string };
      };
      world.payable = {
        ...world.payable,
        method: draft.method ?? 'PIX',
        customer: { ...world.payable.customer, ...draft.buyer },
      };
      return { payable: world.payable, view: viewOf(world.payable, charges) };
    },
    view: async () => viewOf(world.payable, charges),
    stateToken: (payable: Payable) => (payable.state === 'OPEN' ? 'AWAITING_PAYMENT' : 'PAID'),
  };
}

/** The host's own settlement writes. A container is moved, never a binding. */
function correlationPort(world: { payable: Payable }) {
  return {
    attachPending: async () => undefined,
    recordCardOutcome: async ({ approved }: { approved: boolean }) => {
      world.payable = { ...world.payable, state: approved ? 'SETTLED' : 'CLOSED' };
      return approved ? 'PAID' : 'FAILED';
    },
    settle: async () => {
      world.payable = { ...world.payable, state: 'SETTLED' };
      return 'PAID';
    },
  };
}

/**
 * The host's vault.
 *
 * `resolve` answers three different things on purpose: a token, an id the
 * caller OWNS that this scope cannot charge (409 — "not usable here", never a
 * decline), and an id the vault has never heard of.
 */
function instrumentsPort(spec: HarnessStoreSpec, world: HarnessWorld, changed: () => void) {
  return {
    list: async () =>
      (spec.instruments ?? []).map((card) => ({
        id: card.id,
        last4: card.last4,
        brand: card.brand ?? 'visa',
        expMonth: 12,
        expYear: 2031,
        holder: 'ANA COMPRADORA',
      })),
    resolve: async (_caller: unknown, _scope: unknown, instrumentId: string) => {
      if (spec.unusableInstruments?.includes(instrumentId)) return { token: null, owned: true };
      const known = spec.instruments?.some((card) => card.id === instrumentId);
      return known ? { token: `vault_${instrumentId}` } : { token: null, owned: false };
    },
    save: async (_caller: unknown, scope: { provider: string }, token: string, display: unknown) => {
      world.vaulted.push({ provider: scope.provider, token, display });
      changed();
    },
  };
}

/** The host's view, including the PIX payload (or hosted URL) just raised. */
function viewOf(payable: Payable, charges: MemoryChargeStore): HarnessView {
  const raised = charges
    .all()
    .filter((stored) => stored.snapshot.reference?.startsWith(payable.ref))
    .at(-1);
  const snapshot = raised?.snapshot;
  return {
    invoice: payable.ref,
    total: payable.amount.amountCents,
    totalLabel: brlLabel(payable.amount.amountCents),
    ...(snapshot?.pix?.qrText
      ? {
          pix: {
            copyPaste: snapshot.pix.qrText,
            expiresAt: snapshot.pix.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        }
      : {}),
    ...(snapshot?.hostedCheckoutUrl ? { hostedCheckoutUrl: snapshot.hostedCheckoutUrl } : {}),
  };
}

/** A minimal listener set — the probe re-renders off this, not off a timer. */
function notifier(): { fire: () => void; subscribe: HarnessWorld['subscribe'] } {
  const listeners = new Set<() => void>();
  return {
    fire: () => listeners.forEach((listener) => listener()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The gateway, with one local adapter per declared chain entry. */
function harnessGateway(chain: readonly HarnessProvider[], seen: SeenCharge[], charges: MemoryChargeStore, credentials: MemoryCredentialStore) {
  return createPaymentsGateway({
    providers: defineProviders(
      Object.fromEntries(chain.map((entry) => [entry.name, harnessAdapter(entry, seen)])),
    ),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
}

/**
 * The host's payable, before anything has happened to it.
 *
 * An INVOICE, deliberately: nothing order-shaped reaches the mount, which is
 * the falsifiable half of the FUT-740 design. A payable already SETTLED is the
 * store a buyer comes back to from a hosted provider — the webhook landed while
 * they were away.
 */
function seedPayable(spec: HarnessStoreSpec): { payable: Payable } {
  return {
    payable: {
      ref: 'inv_harness_0043',
      merchant: MERCHANT,
      amount: BRL(spec.amountCents ?? 7500),
      method: 'PIX',
      customer: spec.customer ?? { name: 'Ana Compradora', email: 'ana@exemplo.com' },
      state: spec.settled ? 'SETTLED' : 'OPEN',
    } satisfies Payable as Payable,
  };
}

/**
 * The `fetch` the published client is handed: record what crossed, then route
 * it straight into the mount.
 *
 * The recording is the whole point. It is the only place the BYTES are visible,
 * and every FUT-740 critical was a byte-level disagreement that both sides'
 * own tests were structurally unable to see.
 */
function transportInto(
  routes: PaymentFlowsBE,
  out: HarnessWorld,
  fire: () => void,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    // Named anything but `path`: a local called `path` reads as `node:path` to
    // the flakiness gate's unmocked-fs rule.
    const target = String(input);
    const [route = '', query] = target.replace('/api/checkout', '').split('?');
    out.requests.push({
      method: init?.method ?? 'GET',
      path: target.split('?')[0] ?? target,
      body: parseBody(init?.body),
    });
    fire();
    const url = `https://loja.exemplo/api/checkout${route}${query ? `?${query}` : ''}`;
    const verb = (init?.method ?? 'GET') as 'GET' | 'POST';
    const response = await routes[verb](new Request(url, init as RequestInit), {
      params: { segments: route.split('/').filter(Boolean) },
    });
    fire();
    return response;
  };
}

/**
 * Build the store. Everything below the `fetch` is real: the gateway, the
 * failover walk, the reference convention, the charge-identity guards, the
 * buyer-field gate and the copy table are the shipped ones.
 */
export function createHarnessStore(spec: HarnessStoreSpec = {}): HarnessWorld {
  const chain = spec.chain ?? [{ name: 'aurora', stub: true, publicKey: 'pk_harness' }];
  const seen: SeenCharge[] = [];
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const connections = createMemoryProviderConfigStore();
  const { fire, subscribe } = notifier();
  seedConnections(chain, credentials, connections);
  const world = seedPayable(spec);

  const out: HarnessWorld = {
    fetchImpl: (() => undefined) as unknown as typeof fetch,
    seen,
    requests: [],
    vaulted: [],
    navigated: [],
    recordNavigation: (url: string) => {
      out.navigated.push(url);
      fire();
    },
    subscribe,
    createPayable: async () => new Response(null),
  };

  const routes = createPaymentFlowsBE<{ id: string }, HarnessView>({
    gateway: harnessGateway(chain, seen, charges, credentials),
    charges,
    credentials,
    connections,
    requireAuth: () => ({ id: 'buyer-1' }),
    resolveMerchant: () => MERCHANT,
    browserKey: (_merchant, provider) =>
      // A connection that can mint a key ON DEMAND — the case that exercises
      // "PUBLIC_KEY with a null key" needs this to answer.
      Promise.resolve(chain.find((entry) => entry.name === provider)?.publicKey ?? null),
    payables: payablesPort(world, charges),
    correlation: correlationPort(world),
    instruments: instrumentsPort(spec, out, fire),
    copy: harnessCopy,
    logger: { warn: () => undefined, error: () => undefined, providerFailure: () => undefined },
  });

  const call = transportInto(routes, out, fire);
  out.fetchImpl = call as typeof fetch;
  out.createPayable = (body) =>
    call('/api/checkout', { method: 'POST', body: JSON.stringify(body) });
  return out;
}

/** The request body as an object, or null — never a throw on a GET. */
function parseBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
