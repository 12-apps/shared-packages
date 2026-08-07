/**
 * A whole payable STORE, in a browser tab, with no backend running (FUT-742).
 *
 * ## Why this is not a mock
 *
 * A story that stubs `globalThis.fetch` and answers `{ data: … }` recreates the
 * FUT-740 failure exactly: both halves green, the wire dead. All three
 * criticals that review found lived in the seam between the published client
 * and the published mount — a CARD charge settling a PIX payable, a `/charge`
 * body the shipped client never sends, a CPF the payable could not carry — and
 * not one of them is visible to a test that builds the other side's body by
 * hand.
 *
 * So every story runs a REAL `createPaymentFlowsBE` mount, in the page, behind
 * a `fetch` handed to `createPaymentFlows({ transport })`. The bytes that cross
 * are the bytes production sends. What is stubbed is only what a browser
 * genuinely cannot have: the merchant's stored credentials, and the provider at
 * the other end of them.
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
  createPaymentFlowsBE,
  createPaymentsGateway,
  defineProviders,
  type ChargeInput,
  type MemoryChargeStore,
  type MemoryCredentialStore,
  type MemoryProviderConfigStore,
  type Payable,
  type PaymentMethodKind,
} from "@12-apps/payments-backend";

import {
  BRL,
  MERCHANT,
  storyAdapter,
  storyCopy,
  type StoryProvider,
} from "./store-adapter";

/** The whole store a story is set in. */
export interface StorySpec {
  chain?: StoryProvider[];
  /** Instruments the buyer already has vaulted here. */
  instruments?: { id: string; last4: string; brand?: string }[];
  /**
   * Vault ids this caller OWNS but this store cannot charge (FUT-697) — the
   * "not usable here" case, which must not read as a decline.
   */
  unusableInstruments?: string[];
  amountCents?: number;
  /** The buyer identity the payable itself carries. Never a CPF: no column. */
  customer?: { name?: string; email?: string };
}

/**
 * The host's own body for a payable — the `View` the library echoes verbatim
 * and never reads. A real host puts its order here; this one puts the totals
 * and, for PIX, the payload it read off the charge the mount just raised. That
 * is where the QR legitimately comes from: `attachPix` answers with the VIEW,
 * so the payload reaches a browser through the host or not at all.
 */
interface StoryView {
  invoice: string;
  total: number;
  totalLabel: string;
  pix?: { copyPaste: string; expiresAt: string };
}

/** What a story gets back: the transport to hand the factory, plus the truth. */
export interface StoryWorld {
  /** Hand this to `createPaymentFlows({ transport: { fetchImpl } })`. */
  fetchImpl: typeof fetch;
  /** Every charge the providers actually received, in order. */
  seen: ChargeInput[];
  /** Every instrument the mount asked to vault. */
  vaulted: { provider: string; token: string; display: unknown }[];
  /** `POST /` — raise the payable and its first charge, over the real wire. */
  createPayable: (body: {
    method: PaymentMethodKind;
    buyer?: { name?: string; email?: string; taxId?: string; phone?: string };
  }) => Promise<Response>;
}

/**
 * The merchant's stored credentials and connections — the two things a browser
 * genuinely cannot have, and the ONLY things a story fakes.
 *
 * The STORED CONNECTION is where `mockTokenization` comes from; the credential
 * store is not consulted for it. A story that set the stub flag only on the
 * credentials would publish `mockTokenization: false`, and the card form would
 * then refuse a card it has no way to mint — which is exactly the silence the
 * FUT-697 bug lived in.
 */
function seedConnections(
  chain: readonly StoryProvider[],
  credentials: MemoryCredentialStore,
  connections: MemoryProviderConfigStore,
): void {
  for (const [rank, entry] of chain.entries()) {
    const fields: Record<string, string> = entry.publicKey
      ? { publicKey: entry.publicKey }
      : {};
    credentials.set(MERCHANT, entry.name, {
      environment: "SANDBOX",
      fields,
      stub: entry.stub ?? false,
    });
    void connections.save(MERCHANT, {
      provider: entry.name,
      enabled: true,
      priority: rank,
      environment: "SANDBOX",
      status: "VERIFIED",
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
 * arrive with the request that raises it. That is the third FUT-740 critical,
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
        method: draft.method ?? "PIX",
        customer: { ...world.payable.customer, ...draft.buyer },
      };
      return { payable: world.payable, view: viewOf(world.payable, charges) };
    },
    view: async () => viewOf(world.payable, charges),
    stateToken: (payable: Payable) => (payable.state === "OPEN" ? "AWAITING_PAYMENT" : "PAID"),
  };
}

/** The host's own settlement writes. A container is moved, never a binding. */
function correlationPort(world: { payable: Payable }) {
  return {
    attachPending: async () => undefined,
    recordCardOutcome: async ({ approved }: { approved: boolean }) => {
      world.payable = { ...world.payable, state: approved ? "SETTLED" : "CLOSED" };
      return approved ? "PAID" : "FAILED";
    },
    settle: async () => {
      world.payable = { ...world.payable, state: "SETTLED" };
      return "PAID";
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
function instrumentsPort(
  spec: StorySpec,
  vaulted: StoryWorld["vaulted"],
) {
  return {
    list: async () =>
      (spec.instruments ?? []).map((card) => ({
        id: card.id,
        last4: card.last4,
        brand: card.brand ?? "visa",
      })),
    resolve: async (_caller: unknown, _scope: unknown, instrumentId: string) => {
      if (spec.unusableInstruments?.includes(instrumentId)) return { token: null, owned: true };
      const known = spec.instruments?.some((card) => card.id === instrumentId);
      return known ? { token: `vault_${instrumentId}` } : { token: null, owned: false };
    },
    save: async (_caller: unknown, scope: { provider: string }, token: string, display: unknown) => {
      vaulted.push({ provider: scope.provider, token, display });
    },
  };
}

/**
 * Build the store. Everything below the `fetch` is real: the gateway, the
 * failover walk, the reference convention, the charge-identity guards, the
 * buyer-field gate and the copy table are the shipped ones.
 */
export function createStoryStore(spec: StorySpec = {}): StoryWorld {
  const chain = spec.chain ?? [{ name: "aurora", stub: true, publicKey: null }];
  const seen: ChargeInput[] = [];
  const vaulted: StoryWorld["vaulted"] = [];
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const gateway = createPaymentsGateway({
    providers: defineProviders(
      Object.fromEntries(chain.map((entry) => [entry.name, storyAdapter(entry, seen)])),
    ),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
  const connections = createMemoryProviderConfigStore();
  seedConnections(chain, credentials, connections);

  // The payable is an INVOICE. Nothing order-shaped reaches the mount, which is
  // the falsifiable half of the FUT-740 design.
  const world = {
    payable: {
      ref: "inv_2026_0043",
      merchant: MERCHANT,
      amount: BRL(spec.amountCents ?? 7500),
      method: "PIX",
      customer: spec.customer ?? { name: "Ana Compradora", email: "ana@exemplo.com" },
      state: "OPEN",
    } satisfies Payable as Payable,
  };

  const routes = createPaymentFlowsBE<{ id: string }, StoryView>({
    gateway,
    charges,
    credentials,
    connections,
    requireAuth: () => ({ id: "buyer-1" }),
    resolveMerchant: () => MERCHANT,
    browserKey: (_merchant, provider) =>
      // A connection that can mint a key ON DEMAND. The stories that exercise
      // "PUBLIC_KEY with a null key" need this to answer; the ones that do not
      // declare a key simply never reach it.
      Promise.resolve(chain.find((entry) => entry.name === provider)?.publicKey ?? null),
    payables: payablesPort(world, charges),
    correlation: correlationPort(world),
    instruments: instrumentsPort(spec, vaulted),
    copy: storyCopy,
    logger: { warn: () => undefined, error: () => undefined, providerFailure: () => undefined },
  });

  const call = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Named anything but `path`: a local called `path` reads as `node:path` to
    // the flakiness gate's unmocked-fs rule.
    const target = String(input);
    const [route = "", query] = target.replace("/api/checkout", "").split("?");
    const url = `https://loja.exemplo/api/checkout${route}${query ? `?${query}` : ""}`;
    const verb = (init?.method ?? "GET") as "GET" | "POST";
    return routes[verb](new Request(url, init as RequestInit), {
      params: { segments: route.split("/").filter(Boolean) },
    });
  };

  return {
    fetchImpl: call as typeof fetch,
    seen,
    vaulted,
    createPayable: (body) =>
      call("/api/checkout", { method: "POST", body: JSON.stringify(body) }),
  };
}

/**
 * The host's view, including the PIX payload when one was just raised.
 *
 * Reading it off the charge store is not a shortcut: the mount answers a PIX
 * create with the host's VIEW and nothing else, so a host that does not carry
 * the payload forward has a buyer looking at a payment step with no code on it.
 */
function viewOf(payable: Payable, charges: MemoryChargeStore): StoryView {
  const raised = charges
    .all()
    .filter((stored) => stored.snapshot.reference?.startsWith(payable.ref))
    .at(-1);
  const pix = raised?.snapshot.pix;
  return {
    invoice: payable.ref,
    total: payable.amount.amountCents,
    totalLabel: brlLabel(payable.amount.amountCents),
    ...(pix?.qrText
      ? {
          pix: {
            copyPaste: pix.qrText,
            expiresAt: pix.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        }
      : {}),
  };
}

/** `R$ 75,00` — the pre-formatted grand total the pay bar shows. */
export function brlLabel(amountCents: number): string {
  return `R$ ${(amountCents / 100).toFixed(2).replace(".", ",")}`;
}
