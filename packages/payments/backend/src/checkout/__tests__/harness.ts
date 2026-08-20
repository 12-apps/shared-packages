import { createPaymentsGateway } from '../../core/gateway';
import type { PaymentProviderAdapter } from '../../core/provider';
import { defineProviders } from '../../core/registry';
import type {
  ClientTokenization,
  MerchantRef,
  Money,
  PaymentMethodKind,
} from '../../core/types';
import { createMemoryWebhookInbox } from '../../memory-webhook-inbox';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
} from '../../memory';
import {
  sharedSecretWebhook,
  stubCharge,
  stubPendingSnapshot,
  stubRefund,
} from '../../providers/shared';
import type { CheckoutCopy } from '../copy';
import { createPaymentFlowsBE } from '../factory';
import type { PaymentFlowsBEConfig } from '../runtime';
import type {
  AttachedCharge,
  CheckoutLogger,
  Payable,
  PayableLoadContext,
} from '../types';

/**
 * A checkout world with NO vendor in it.
 *
 * The two adapters are called `alpha` and `beta` precisely so a leaked provider
 * name is detectable by string search: if either token turns up in a response
 * body outside the config read's legitimate `provider` fields, the mount is
 * telling a buyer something about a vendor, and that is a portability defect
 * rather than a cosmetic one.
 */

export const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'merchant-1' };
export const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });

/** A caller. Opaque to the library — it only ever travels back into the ports. */
interface TestCaller {
  id: string;
}

/** The host's own view of a payable. The library forwards it and never reads it. */
interface InvoiceView {
  invoice: string;
  total: number;
  state: string;
}

interface AdapterOptions {
  tokenization?: ClientTokenization;
  /**
   * What this adapter declares it can charge. Defaults to both — a PIX-ONLY
   * adapter is the shape FUT-747 is about, and no shipped vendor is one yet.
   */
  methods?: readonly PaymentMethodKind[];
  /** Answer every charge with a hosted-checkout link instead of a payload. */
  hosted?: boolean;
  /** The vendor's own name as a buyer reads it; defaults to the adapter's id. */
  displayName?: string;
  /** Refuse every charge, provably creating nothing. */
  refuses?: boolean;
  cancelable?: boolean;
  /** What a status poll reports back — how much the provider actually took. */
  settledAmount?: Money;
}

export function testAdapter(name: string, options: AdapterOptions = {}): PaymentProviderAdapter {
  const adapter: PaymentProviderAdapter = {
    name,
    displayName: options.displayName ?? name,
    capabilities: {
      methods: options.methods ?? ['PIX', 'CARD'],
      savedCards: true,
      refunds: true,
      partialRefunds: true,
      splits: false,
      webhooks: true,
      tokenization: options.tokenization ?? 'PUBLIC_KEY',
    },
    credentialSchema: [{ key: 'secretKey', label: 'Secret', secret: true, required: true }],
    async verifyCredentials() {
      return { ok: true };
    },
    async createCharge(input, credentials) {
      if (options.refuses) {
        // A PROVABLY pre-send failure — the connection was refused, so nothing
        // reached the provider and the walk is entitled to advance. Anything
        // vaguer would (correctly) stop the walk for a probe instead.
        throw new TypeError(`fetch failed: ${name} is down`, {
          cause: { code: 'ECONNREFUSED' },
        });
      }
      const snapshot = stubCharge(name, input, credentials);
      if (!options.hosted) return snapshot;
      return {
        ...snapshot,
        status: 'PENDING',
        pix: undefined,
        hostedCheckoutUrl: `https://${name}.example/checkout/${snapshot.providerChargeId}`,
      };
    },
    async getCharge(providerChargeId) {
      const pending = stubPendingSnapshot(name, providerChargeId);
      if (!options.settledAmount) return pending;
      return { ...pending, status: 'PAID', amount: options.settledAmount };
    },
    async refund(input) {
      return stubRefund(name, input);
    },
    webhook: sharedSecretWebhook(name),
    clientConfig: () => ({ provider: name, tokenization: options.tokenization ?? 'PUBLIC_KEY' }),
  };
  if (!options.cancelable) return adapter;
  return {
    ...adapter,
    async cancelCharge(providerChargeId) {
      return { ...stubPendingSnapshot(name, providerChargeId), status: 'CANCELED' };
    },
  };
}

/** Every correlation write the mount made, in order — the assertion surface. */
interface CorrelationLog {
  pending: { ref: string; charge: AttachedCharge }[];
  cardOutcomes: { ref: string; approved: boolean; amount: Money }[];
  settlements: { ref: string; capturedAmount: Money }[];
  expiries: string[];
}

/** Every vaulting the mount asked for — the opt-in half of the charge body. */
interface VaultLog {
  saved: { provider: string; token: string; display: unknown }[];
}

/**
 * A copy table of MACHINE-READABLE sentinels rather than prose.
 *
 * Asserting on Portuguese would tie these tests to one host's product copy and
 * would not prove what actually matters — that the right RULE fired. The
 * sentinels make "an exhausted chain was worded once, by us" checkable without
 * anyone having to read a sentence.
 */
const testCopy: CheckoutCopy = {
  notConfigured: 'copy.notConfigured',
  chainExhausted: (method) => `copy.chainExhausted.${method}`,
  unresolvedCharge: 'copy.unresolvedCharge',
  chargeMismatch: 'copy.chargeMismatch',
  instrumentNotUsableHere: 'copy.instrumentNotUsableHere',
  payableNotFound: 'copy.payableNotFound',
  buyerFieldMissing: (fields) => `copy.missing.${[...fields].join('+')}`,
  buyerFieldInvalid: (field) => `copy.invalid.${field}`,
  fieldNameOf: (field) => (field === 'taxId' ? 'cpf' : field),
  genericProviderRefusal: 'copy.generic',
};

const silentTestLogger: CheckoutLogger = {
  warn: () => undefined,
  error: () => undefined,
  providerFailure: () => undefined,
};

interface WorldOptions {
  chain?: readonly { name: string; adapter: PaymentProviderAdapter }[];
  payable?: Partial<Payable>;
  offlineSettlement?: { afterMs: number };
  /**
   * The vault's contents, by instrument id:
   *
   *   - a STRING — the vault token this scope charges it with;
   *   - `null`   — an id the caller OWNS that this scope cannot charge (FUT-697);
   *   - absent   — an id the vault has never heard of.
   *
   * The last two are only distinguishable through `owned`, and telling them
   * apart is what lets the published flat body — whose one `token` field is
   * either a fresh instrument or a saved one's id — be resolved at all.
   */
  instruments?: Record<string, string | null>;
  config?: Partial<PaymentFlowsBEConfig<TestCaller, InvoiceView>>;
}

/**
 * A fresh, fully isolated checkout world. Built INSIDE each test so no state
 * ever crosses a test boundary.
 *
 * The payable is an INVOICE, with no order semantics anywhere in it. That is
 * the falsifiable half of the whole design: if driving create → charge → status
 * needs anything order-shaped, `PayablePort` is an order in disguise and the
 * abstraction has failed.
 */
export function setupCheckoutWorld(options: WorldOptions = {}) {
  const chain = options.chain ?? [{ name: 'alpha', adapter: testAdapter('alpha') }];
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const connections = createMemoryProviderConfigStore();
  const providers = defineProviders(
    Object.fromEntries(chain.map((entry) => [entry.name, entry.adapter])),
  );
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
  for (const entry of chain) {
    credentials.set(MERCHANT, entry.name, { environment: 'SANDBOX', fields: {}, stub: true });
  }

  const payable: Payable = {
    ref: 'inv_2024_0043',
    merchant: MERCHANT,
    amount: BRL(7500),
    method: 'PIX',
    customer: { name: 'Ana Buyer', email: 'ana@example.com', taxId: '12345678909' },
    state: 'OPEN',
    ...options.payable,
  };
  // A CONTAINER, so a port can move the payable's state without any stub
  // reassigning a closed-over binding.
  const world = { payable, created: 0 };

  const correlation: CorrelationLog = {
    pending: [],
    cardOutcomes: [],
    settlements: [],
    expiries: [],
  };
  const vault: VaultLog = { saved: [] };
  /**
   * Every context `payables.load` was handed. The host's load IS the
   * authorization scope, so what it can SEE is part of the contract.
   */
  const loads: PayableLoadContext[] = [];

  const viewOf = (): InvoiceView => ({
    invoice: world.payable.ref,
    total: world.payable.amount.amountCents,
    state: world.payable.state,
  });

  const routes = createPaymentFlowsBE<TestCaller, InvoiceView>({
    gateway,
    charges,
    credentials,
    connections,
    requireAuth: () => ({ id: 'caller-1' }),
    resolveMerchant: () => MERCHANT,
    payables: {
      load: async (_caller, ref, context) => {
        loads.push(context);
        return ref === world.payable.ref ? world.payable : null;
      },
      create: async () => {
        world.created += 1;
        return { payable: world.payable, view: viewOf() };
      },
      view: async () => viewOf(),
      stateToken: (loaded) => loaded.state,
    },
    correlation: {
      attachPending: async (ref, charge) => {
        correlation.pending.push({ ref, charge });
      },
      recordCardOutcome: async ({ ref, approved, amount }) => {
        correlation.cardOutcomes.push({ ref, approved, amount });
        world.payable = { ...world.payable, state: approved ? 'SETTLED' : 'CLOSED' };
        return world.payable.state;
      },
      settle: async ({ ref, capturedAmount }) => {
        correlation.settlements.push({ ref, capturedAmount });
        world.payable = { ...world.payable, state: 'SETTLED' };
        return 'SETTLED';
      },
      expire: async (ref) => {
        correlation.expiries.push(ref);
        world.payable = { ...world.payable, state: 'CLOSED' };
        return 'EXPIRED';
      },
    },
    instruments: {
      list: async () => [{ id: 'card_1', last4: '4242' }],
      resolve: async (_caller, _scope, instrumentId) => {
        const known = options.instruments ?? {};
        const token = known[instrumentId];
        if (token) return { token };
        return { token: null, owned: Object.hasOwn(known, instrumentId) };
      },
      save: async (_caller, scope, token, display) => {
        vault.saved.push({ provider: scope.provider, token, display });
      },
    },
    // The buyer-vault ownership facts (FUT-478): derived from the CALLER,
    // which is exactly what the server-derivation tests assert the adapter saw
    // — a request body has no way to produce `vault_caller-1`.
    vault: async (caller) => ({
      reference: `vault_${caller.id}`,
      customer: { name: 'Ana Buyer', email: 'ana@example.com', taxId: '12345678909' },
      customerRef: 'cus_host_9',
    }),
    copy: testCopy,
    logger: silentTestLogger,
    ...(options.offlineSettlement ? { offlineSettlement: options.offlineSettlement } : {}),
    ...options.config,
  });

  return {
    routes,
    charges,
    credentials,
    connections,
    gateway,
    correlation,
    vault,
    loads,
    world,
  };
}

/** A request at a checkout sub-path, as the catch-all mount receives it. */
export function request(
  method: 'GET' | 'POST',
  target: string,
  body?: unknown,
): { request: Request; context: { params: { segments: string[] } } } {
  const [pathname = '', query] = target.split('?');
  const url = `https://shop.example/api/checkout${pathname}${query ? `?${query}` : ''}`;
  return {
    request: new Request(url, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
    context: { params: { segments: pathname.split('/').filter(Boolean) } },
  };
}

/** Drive the catch-all mount and read back the parsed JSON body. */
export async function call(
  routes: ReturnType<typeof setupCheckoutWorld>['routes'],
  method: 'GET' | 'POST',
  target: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const built = request(method, target, body);
  const response = await routes[method](built.request, built.context);
  const text = await response.text();
  // A host's refusal body is the HOST's shape, not ours — a mount that answers
  // with whatever `requireAuth` returned must not be forced through a parser.
  const parsed = ((): Record<string, unknown> => {
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { raw: text };
    }
  })();
  return { status: response.status, body: parsed };
}
