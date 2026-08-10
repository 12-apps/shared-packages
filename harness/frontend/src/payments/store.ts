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
  ProviderRequestError,
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  createMemoryWebhookInbox,
  createPaymentFlowsBE,
  createPaymentsGateway,
  defineProviders,
  type CheckoutErrorBody,
  type MemoryChargeStore,
  type MemoryCredentialStore,
  type MemoryProviderConfigStore,
  type PaymentMethodKind,
  type VaultedCardDisplay,
} from '@12-apps/payments-backend';

import {
  MERCHANT,
  harnessAdapter,
  harnessCopy,
  type HarnessProvider,
  type SeenCharge,
} from './adapter';
import { correlationPort, payablesPort, seedPayables, type HarnessView } from './payables';
import { notifier, recordingTransport, type WireRequest } from './wire';

// The admin store shares the wire (`./wire.ts`); pages and the probe keep
// importing the request shape from here, where it has always lived.
export type { WireRequest } from './wire';

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

/** A card the buyer put on file THIS session, through `/cards/complete`. */
interface AddedInstrument {
  id: string;
  token: string;
  display: VaultedCardDisplay;
}

/**
 * The host's vault.
 *
 * `resolve` answers three different things on purpose: a token, an id the
 * caller OWNS that this scope cannot charge (409 — "not usable here", never a
 * decline), and an id the vault has never heard of.
 *
 * `save` also keeps its own ROWS, the way a real host writes a table: the ids
 * are minted here and the vault token stays behind them, so `list` can answer
 * a card added a moment ago with display metadata only — which is what lets
 * the wallet page's saved list re-read what is now on file.
 */
function instrumentsPort(spec: HarnessStoreSpec, world: HarnessWorld, changed: () => void) {
  const added: AddedInstrument[] = [];
  return {
    list: async () => [
      ...(spec.instruments ?? []).map((card) => ({
        id: card.id,
        last4: card.last4,
        brand: card.brand ?? 'visa',
        expMonth: 12,
        expYear: 2031,
        holder: 'ANA COMPRADORA',
      })),
      ...added.map((row) => ({
        id: row.id,
        last4: row.display.last4 ?? '0000',
        brand: row.display.brand ?? 'visa',
        expMonth: row.display.expMonth ?? 12,
        expYear: row.display.expYear ?? 2031,
        holder: 'ANA COMPRADORA',
      })),
    ],
    resolve: async (_caller: unknown, _scope: unknown, instrumentId: string) => {
      if (spec.unusableInstruments?.includes(instrumentId)) return { token: null, owned: true };
      const row = added.find((entry) => entry.id === instrumentId);
      if (row) return { token: row.token };
      const known = spec.instruments?.some((card) => card.id === instrumentId);
      return known ? { token: `vault_${instrumentId}` } : { token: null, owned: false };
    },
    save: async (_caller: unknown, scope: { provider: string }, token: string, display: unknown) => {
      // The display is whatever the mount answered `/cards/complete` with —
      // display metadata only by contract, so the row narrows it as such.
      added.push({ id: `card_nova_${added.length + 1}`, token, display: display as VaultedCardDisplay });
      world.vaulted.push({ provider: scope.provider, token, display });
      changed();
    },
  };
}

/**
 * The host's wording for ONE provider-vocabulary failure: the stub vault's
 * validation 400 (FUT-478). Field-level on purpose — the refused add-card form
 * keeps the buyer's input under a reason naming what to fix, which is the seam
 * the S2 tests pin. Nothing else reaches this mapping in the harness: the
 * charge-path adapters answer declines as OUTCOMES, never as thrown errors.
 */
function vaultValidationRefusal(error: unknown): CheckoutErrorBody | null {
  if (!(error instanceof ProviderRequestError) || error.options.httpStatus !== 400) return null;
  return {
    code: 'CARD_VALIDATION_REFUSED',
    message: 'O cartão foi recusado na validação. Confira os dados e tente de novo.',
    field: 'cardNumber',
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
  const book = seedPayables(spec);

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
    payables: payablesPort(book, charges),
    correlation: correlationPort(book),
    instruments: instrumentsPort(spec, out, fire),
    // The buyer-vault ownership facts (FUT-478): reference and customer are
    // derived from the CALLER, never read from a request body — the same rule
    // the S2 server-derivation tests pin. Wired unconditionally: a store whose
    // chain head declares no `vault` seam still answers the not-enabled 404.
    vault: async (caller) => ({
      reference: `vault_${caller.id}`,
      customer: { name: 'Ana Compradora', email: 'ana@exemplo.br', taxId: '52998224725' },
    }),
    mapProviderError: vaultValidationRefusal,
    copy: harnessCopy,
    logger: { warn: () => undefined, error: () => undefined, providerFailure: () => undefined },
  });

  // The recording transport (`./wire.ts`) is the only place the BYTES are
  // visible — every FUT-740 critical was a byte-level disagreement both sides'
  // own tests were structurally unable to see.
  const call = recordingTransport<'GET' | 'POST'>(routes, {
    baseUrl: '/api/checkout',
    requests: out.requests,
    fire,
  });
  out.fetchImpl = call as typeof fetch;
  out.createPayable = (body) =>
    call('/api/checkout', { method: 'POST', body: JSON.stringify(body) });
  return out;
}
