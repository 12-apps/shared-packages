/**
 * The persistence and provider halves `@12-apps/payments-backend` asks a host
 * for — over the REAL tables its own partial declares.
 *
 * Every other db seam in this harness is hand-written SQL, deliberately (the
 * packages declare their stores structurally, so filling one with SQL proves
 * the routes cannot tell what is underneath). This one is the opposite on
 * purpose: the package SHIPS Prisma implementations of its four stores, and a
 * consumer that re-wrote them by hand would be testing its own SQL rather than
 * the thing an adopter actually installs. `prisma.ts` explains why that pairing
 * — the partial and the migrations, in contact through a generated client — is
 * the one claim a package's own suite cannot make.
 *
 * ## The providers are vendor-free, and named so nothing recognises them
 *
 * `cascata` and `corrente` are not acquirers. A harness that reached for a real
 * vendor adapter would need credentials, a network and a homologation, and
 * would prove nothing about the mount; what these two exist for is the SHAPE
 * the gateway routes over — one that pays, one that declines technically so the
 * failover walk has somewhere to go.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';

import {
  ProviderRequestError,
  createPaymentsGateway,
  createPrismaAttemptLedger,
  createPrismaChargeStore,
  createPrismaProviderConfigStore,
  createPrismaWebhookInbox,
  createSettingsService,
  credentialStoreFrom,
  defineProviders,
  type ChargeQueryStore,
  type ChargeStore,
  type Cipher,
  type MerchantRef,
  type PaymentProviderAdapter,
  type PaymentsGateway,
  type ProviderConfigStore,
  type ProviderRegistry,
  type SettingsService,
} from '@12-apps/payments-backend';
import type { ActivationProofStore } from '@12-apps/payments-backend';

import type { HarnessPrismaClient } from './prisma';

/**
 * The package's own migrations, out of the tarball.
 *
 * Located by path rather than by `require.resolve` and read from
 * `node_modules`: these are shipped ASSETS, not module entry points, and a host
 * applies them with a deploy step rather than importing them. Applying THESE —
 * instead of a hand-written CREATE TABLE — is what puts the shipped migration
 * and the shipped Prisma store in contact.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/payments-backend/prisma/migrations/', import.meta.url),
);

/** Apply the published payments migrations, in name order — as a deploy would. */
export async function applyPaymentsMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // Zero would leave every query failing as "relation payment_provider_configs
  // does not exist" rather than as the packaging mistake it is.
  if (names.length === 0) throw new Error(`No payments migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/** The store this harness charges for — a TENANT, never the platform. */
export const PAYMENTS_MERCHANT: MerchantRef = { kind: 'TENANT', id: 'loja-harness' };

/** The neighbour, for the ownership questions one merchant cannot ask alone. */
export const PAYMENTS_MERCHANT_B: MerchantRef = { kind: 'TENANT', id: 'loja-vizinha' };

/** Pays. Opaque, so no tokenizer recognises it and no vendor SDK is reached for. */
export const PAYING_PROVIDER = 'cascata';
/** Fails TECHNICALLY, which is the only failure the default policy walks past. */
export const FAILING_PROVIDER = 'corrente';

/** What a suite flips to drive the paths a request cannot provoke from outside. */
export const paymentsProviders = {
  /** `corrente` stops failing, so a chain that fell through it now settles there. */
  secondProviderRecovers: false,
  reset(): void {
    paymentsProviders.secondProviderRecovers = false;
  },
};

/**
 * A cipher over the credentials blob.
 *
 * Base64 rather than AES here, and the difference from `impersonation-host.ts`
 * (which derives a real key) is the threat: an impersonation cookie is handed to
 * a browser, while this blob never leaves the database. What the store needs
 * from a host is a round trip and a shape it cannot read by accident, both of
 * which this gives — a real deployment passes its KMS.
 */
const cipher: Cipher = {
  encrypt: (plaintext) => `b64:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (ciphertext) => Buffer.from(ciphertext.replace(/^b64:/, ''), 'base64').toString('utf8'),
};

/** One adapter, parameterised by whether it settles or refuses. */
function stubAdapter(name: string, settles: () => boolean): PaymentProviderAdapter {
  return {
    name,
    displayName: name === PAYING_PROVIDER ? 'Cascata' : 'Corrente',
    capabilities: {
      // PIX only, deliberately: a card charge needs a tokenizer, and the whole
      // point of these two names is that no tokenizer recognises them.
      methods: ['PIX'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'NONE',
    },
    // WHAT THE HOST MUST COLLECT to connect a merchant — declared by the
    // adapter, because it is a fact about the provider rather than about any
    // one host's form. Without it the settings surface has nothing to validate
    // a submitted field against, and `assertFieldsMatchSchema` reads an
    // undefined list — which is a 500 on a request the schema should have
    // refused with a sentence.
    credentialSchema: [
      { key: 'apiKey', label: 'Chave de API', secret: true, required: true },
    ],
    async createCharge(input) {
      if (!settles()) {
        // TECHNICAL, not a decline: the default failover policy advances the
        // chain for one and stops on the other, and a harness whose only
        // failure was a decline could never reach the walk.
        throw new ProviderRequestError(name, 'the acquirer is unreachable (stub).', {
          retriable: true,
        });
      }
      return {
        provider: name,
        providerChargeId: `ch_${input.idempotencyKey ?? randomUUID()}`,
        status: 'PAID',
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        raw: {},
      };
    },
    async getCharge(providerChargeId, _creds, hints) {
      return {
        provider: name,
        providerChargeId,
        status: settles() ? 'PAID' : 'PENDING',
        amount: hints?.amount ?? { amountCents: 0, currency: 'BRL' },
        method: hints?.method ?? 'PIX',
        reference: hints?.reference ?? '',
        raw: {},
      };
    },
    async verifyCredentials() {
      return { ok: true };
    },
    /**
     * The RECONCILIATION PROBE, and answering it is what makes failing over
     * FROM this provider safe at all: without it the gateway sees
     * `probeResult: 'UNSUPPORTED'` on an ambiguous error and stops the walk
     * rather than risk a double charge. This stub never created anything when
     * it refused, so `null` is the truth — a real adapter asks its API.
     */
    async findChargeByReference() {
      return null;
    },
  } as unknown as PaymentProviderAdapter;
}

/** The two adapters this deployment routes over. */
export function harnessProviders(): ProviderRegistry {
  return defineProviders({
    [PAYING_PROVIDER]: stubAdapter(PAYING_PROVIDER, () => true),
    [FAILING_PROVIDER]: stubAdapter(
      FAILING_PROVIDER,
      () => paymentsProviders.secondProviderRecovers,
    ),
  }) as ProviderRegistry;
}

/** Everything the two mounts are built over, in one object. */
export interface PaymentsStores {
  providers: ProviderRegistry;
  config: ProviderConfigStore;
  charges: ChargeStore & ChargeQueryStore;
  gateway: PaymentsGateway;
  settings: SettingsService;
  proofs: ActivationProofStore;
  /** Every charge the host was told to settle — the domain reaction, recorded. */
  settled: { reference: string; provider: string }[];
}

/** A Prisma delegate, as the package's stores duck-type it. */
type Delegate = Record<string, (...args: never[]) => Promise<never>>;

/**
 * The stores, built over the harness's generated client.
 *
 * `$transaction` is passed through because the config store REQUIRES it: a
 * failover chain rewritten with sequential writes can leave two providers
 * sharing a rank, or none enabled at all, which takes checkout offline
 * silently. That is the package's rule; supplying the runner is the host's
 * half of it.
 */
export function paymentsStores(prisma: HarnessPrismaClient): PaymentsStores {
  const delegate = (model: string): Delegate => prisma[model] as unknown as Delegate;
  const providers = harnessProviders();
  const config = createPrismaProviderConfigStore(
    delegate('paymentProviderConfig') as never,
    cipher,
    ((run: never) =>
      (prisma['$transaction'] as (fn: never) => Promise<never>)(run)) as never,
    delegate('paymentMerchantSettings') as never,
  );
  const charges = createPrismaChargeStore(delegate('paymentCharge') as never);
  const settled: PaymentsStores['settled'] = [];

  const gateway = createPaymentsGateway({
    providers,
    // The gateway's credential half IS the config store, read through the
    // package's own adapter — a host that re-derived the chain here would be
    // one rename away from routing over a different order than the settings
    // screen shows.
    credentials: credentialStoreFrom(config, { allowStubMode: true }),
    charges,
    webhooks: createPrismaWebhookInbox(delegate('paymentWebhookEvent') as never),
    attempts: createPrismaAttemptLedger(delegate('paymentChargeAttempt') as never),
    // The merchant's own answer, read from the row the settings surface writes
    // — without this every merchant shares the construction-time default, which
    // makes the setting unreachable to the people it is for.
    failoverPolicyFor: (merchant) => config.getFailoverPolicy(merchant),
  }) as PaymentsGateway;

  return {
    providers,
    config,
    charges,
    gateway,
    settings: createSettingsService(providers, config, {
      // The stub connections are SANDBOX, and a deployment that did not say so
      // would refuse every one of them at resolve time. Said here rather than
      // inferred from the environment, which is the package's own instruction.
      allowStubMode: true,
    }),
    proofs: activationProofs(prisma),
    settled,
  };
}

/**
 * The two durable-proof reads the package deliberately does not own.
 *
 * Both are cross-row queries over the HOST's persistence, shaped by indexes the
 * host controls — which is exactly why they are a port: the sweep keeps the
 * decisions (ownership, what counts as proof) and the host keeps the query.
 */
function activationProofs(prisma: HarnessPrismaClient): ActivationProofStore {
  const configs = prisma['paymentProviderConfig'] as unknown as {
    findMany: (args: unknown) => Promise<
      { merchantKind: string; merchantId: string; provider: string; pendingVerification: unknown }[]
    >;
  };
  const events = prisma['paymentWebhookEvent'] as unknown as {
    findFirst: (args: unknown) => Promise<{ payload: string } | null>;
  };

  return {
    listOutstanding: async (limit) => {
      const rows = await configs.findMany({
        where: { chargeVerifiedAt: null, NOT: { pendingVerification: null } },
        take: limit,
      });
      return rows.map((row) => ({
        merchant: { kind: row.merchantKind as MerchantRef['kind'], id: row.merchantId },
        provider: row.provider,
        reference: referenceOf(row.pendingVerification),
      }));
    },
    findProcessedDeliveryPayload: async (merchant, provider, reference) => {
      const row = await events.findFirst({
        where: {
          merchantKind: merchant.kind,
          merchantId: merchant.id,
          provider,
          status: 'PROCESSED',
          payload: { contains: reference },
        },
      });
      return row?.payload ?? null;
    },
  };
}

/** The stored reference out of a pending-verification blob, or `null`. */
function referenceOf(pending: unknown): string | null {
  if (typeof pending !== 'object' || pending === null) return null;
  const reference = (pending as { reference?: unknown }).reference;
  return typeof reference === 'string' ? reference : null;
}
