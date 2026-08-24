/**
 * `@12-apps/payments-backend`'s MERCHANT-ADMIN surface, adopted through the
 * wiring consumer.
 *
 * What is genuinely the host's, and all that is here: who is calling and which
 * store they act for, which words a receipt reads in, what "settle this" means
 * in this application, and where the durable proof of an activation charge
 * lives. Everything after that — the route table, the dispatcher's
 * parse → requireAuth → resolveMerchant order, the failover walk, the webhook
 * inbox, the four sweeps — is the package's, which is the entire claim.
 *
 * ## Why the BUYER mount is not here
 *
 * The package ships TWO manifests, and its own mount module argues why they
 * must never merge: every library row is merchant-admin, machine or
 * merchant-scoped, and every checkout row is the BUYER. Adopting one without
 * the other is precisely what that split makes expressible — a host binds each
 * behind its own gate, and neither can grow the other's rows.
 *
 * This harness's buyer surface already exists, in `harness/frontend`: the
 * payables book, the correlation port, the tokenizer path and 250 lines of
 * buyer-facing pt-BR live there because that is where a buyer journey runs.
 * Mounting a second one here would be a second answer to the same questions.
 *
 * ## The stores are the shipped Prisma ones
 *
 * `payments-stores.ts` says why: the package ships four Prisma store
 * implementations, and a consumer that hand-wrote them would be testing its own
 * SQL instead of the thing an adopter installs.
 */
import { paymentsBackendManifest } from '@12-apps/payments-backend/manifest';
import { paymentsBackendServerManifest } from '@12-apps/payments-backend/manifest/server';
import type { MerchantRef } from '@12-apps/payments-backend';
import { createPaymentsHttp } from '@12-apps/payments-backend';
import type { Hono } from 'hono';

import type { PGlite } from '@electric-sql/pglite';
import type { BoundJob, MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import type { HarnessPrismaClient } from './prisma';
import { PAYMENTS_MERCHANT, PAYMENTS_MERCHANT_B, paymentsStores } from './payments-stores';
import type { PaymentsStores } from './payments-stores';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** Where `mount-surfaces.ts` hangs the surface — the adoption's claim. */
export const PAYMENTS_MOUNT_PATH = '/api/admin/:tenantSlug/payments';

/** The header a suite sets to act as another store's owner; the SPA sends none. */
const MERCHANT_HEADER = 'x-payments-merchant';
/** `deny` refuses the mount's own gate — the host's verdict, before any handler. */
const GATE_HEADER = 'x-payments-gate';

/** The stores, by the id a request names them with. */
const MERCHANTS: Record<string, MerchantRef> = {
  'loja-harness': PAYMENTS_MERCHANT,
  'loja-vizinha': PAYMENTS_MERCHANT_B,
};

/**
 * THE RECEIPT'S WORDS — the host's, and required to be.
 *
 * The package ships no default in any language, and the reason is the one the
 * frontend harness's copy file states at length: a default is one product's
 * vocabulary spreading into every adopter that said nothing. These sentences
 * are deliberately not that product's.
 */
const RECEIPT_COPY = {
  subject: (receipt: { reference: string }) => `Recibo do pedido ${receipt.reference}`,
  text: (receipt: { reference: string; amountCents: number }) =>
    `Pagamento confirmado: pedido ${receipt.reference}, R$ ${(receipt.amountCents / 100).toFixed(2)}.`,
  html: (receipt: { reference: string; amountCents: number }) =>
    `<p>Pagamento confirmado: pedido <strong>${receipt.reference}</strong>, R$ ${(
      receipt.amountCents / 100
    ).toFixed(2)}.</p>`,
};

export interface PaymentsHost {
  router: ReturnType<typeof honoRouterFor>;
  report: WiringReport;
  routes: readonly MountedRoute[];
  /** The package's OWN blueprints — the two sweeps, the drain, the renewal. */
  jobs: readonly BoundJob[];
  stores: PaymentsStores;
}

/**
 * WHO is calling, and for which store.
 *
 * A real adopter reads a session and its RBAC; this reads a header, which is
 * the one thing a browser genuinely cannot have. What it must not do is default
 * to a merchant: an unnamed store is NOT this harness's store, or every
 * cross-store question below would be asking the same row twice.
 */
function merchantOf(slug: string | undefined, header: string | undefined): MerchantRef | null {
  return MERCHANTS[header ?? slug ?? ''] ?? null;
}

/**
 * The surface, adopted through `@12-apps/wiring/consumer`.
 *
 * `http.create` is the package's own `createWireMountPayments`: `mountPayments`
 * unchanged underneath, plus the countable row view — one descriptor per served
 * row, so the aggregate can report the surface and `unclaimedRoutes()` can name
 * an endpoint a host forgot. A catch-all cannot be counted, which is the silent
 * 404 class the contract exists to end.
 *
 * The webhook row comes through marked `kind: 'webhook'`, and this host's
 * bridge now honours that (#454): a provider callback verified by signature has
 * no caller to resolve, and gating it would refuse every settlement notice the
 * acquirer sends.
 */
export function paymentsHost(prisma: HarnessPrismaClient): PaymentsHost {
  const stores = paymentsStores(prisma);
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: {
      loggerFor: harnessLoggerFor,
      // The same delivery port every other mailing package here is bound to.
      email: { send: async () => undefined },
    },
  });

  host.adoptServer({
    manifest: paymentsBackendManifest as never,
    server: paymentsBackendServerManifest({ receiptCopy: RECEIPT_COPY as never }) as never,
    bindings: {
      http: {
        mountPath: PAYMENTS_MOUNT_PATH,
        config: {
          // Lazily, which is what a host with a database client does: building
          // the gateway at module load drags the client into anything that so
          // much as mentions payments.
          gateway: () =>
            createPaymentsHttp({
              gateway: stores.gateway,
              settings: stores.settings,
              charges: stores.charges,
            }),
          requireAuth: (request: Request, intent: { kind: string }) => {
            // The host's gate, run BEFORE any handler with the parsed intent —
            // and answering a `Response` is how a host refuses outright.
            if (request.headers.get(GATE_HEADER) === 'deny') {
              return new Response(JSON.stringify({ error: 'Sem permissão.' }), {
                status: 403,
                headers: { 'content-type': 'application/json' },
              });
            }
            return { intent: intent.kind, merchantHeader: request.headers.get(MERCHANT_HEADER) };
          },
          resolveMerchant: (auth: { merchantHeader: string | null }) => {
            const merchant = merchantOf(undefined, auth.merchantHeader ?? undefined);
            if (!merchant) throw new Error('no such store');
            return merchant;
          },
        },
      },
      jobs: { deps: jobDeps(stores) },
      email: {},
    },
  });

  const wired = host.assemble();

  return {
    stores,
    report: wired.report,
    routes: wired.routes,
    jobs: wired.jobs,
    // No actor: this mount authorizes itself, in `requireAuth`, with the parsed
    // INTENT in hand — which is a stronger question than "is anyone there" and
    // the reason the package takes the seam rather than a boolean.
    router: honoRouterFor(wired.routes, () => PAYMENTS_CALLER),
  };
}

/**
 * The four blueprints' deps, all of them the host's own.
 *
 * Bound rather than declined, and the difference matters: the cadences and the
 * retry ladders are the package's claims about its own domain, and a host that
 * restates them in its own `defineJob` owns numbers it cannot answer questions
 * about. What is genuinely this host's is here — what "settle" means, where the
 * proof of an activation charge lives, and who to tell when a grant lapses.
 */
function jobDeps(stores: PaymentsStores): Record<string, unknown> {
  return {
    charges: stores.charges,
    gateway: stores.gateway,
    // The HOST's settle path — the same idempotent machinery its webhook
    // reaction uses. Recorded rather than acted on: this harness has no orders,
    // and a settle that did nothing at all would make the sweep unfalsifiable.
    settle: async (snapshot: { reference: string; provider: string }) => {
      stores.settled.push({ reference: snapshot.reference, provider: snapshot.provider });
    },
    replayWebhooks: (options?: unknown) =>
      (stores.gateway as unknown as {
        replayWebhooks: (options?: unknown) => Promise<unknown>;
      }).replayWebhooks(options),
    // A RESOLVER, not the context: the bundle is only available inside a
    // promise, and `adoptServer` takes its bindings synchronously.
    activation: async () => ({
      providers: stores.providers,
      settings: stores.settings,
      config: stores.config,
      charges: stores.charges,
      proofs: stores.proofs,
      allowStubMode: true,
    }),
    oauth: {
      listExpiring: (before: Date, limit: number) => stores.config.listExpiring(before, limit),
      // No OAuth provider is configured here (both adapters are credential
      // mode), so a renewal can only ever be asked for a row that cannot exist.
      // Throwing names that rather than answering a fabricated connection.
      refresh: () => Promise.reject(new Error('no oauth provider in this deployment')),
    },
  };
}

/** The sentinel the bridge treats as "there is a caller" — see the router above. */
const PAYMENTS_CALLER = Object.freeze({});

/**
 * The harness's own window onto the payments tables — deliberately under
 * `/__harness` and never `/api`, so nothing mistakes them for the package's
 * surface.
 *
 * Both answer questions a spec has to ask about ROWS rather than about
 * responses: is the stored credential blob actually opaque, and did the
 * failover walk leave the audit trail it claims to. Through a control rather
 * than a query in the spec — a test reaching into the schema is a test that
 * breaks on a migration it never meant to depend on.
 */
export function mountPaymentsControls(app: Hono, pg: PGlite): void {
  app.get('/__harness/payments/stored-credentials', async (c) => {
    const { rows } = await pg.query<{ credentials: string }>(
      'SELECT credentials FROM payment_provider_configs WHERE provider = $1',
      [c.req.query('provider') ?? ''],
    );
    return c.json({ rows: rows.map((row) => row.credentials) });
  });

  app.get('/__harness/payments/attempts', async (c) => {
    const { rows } = await pg.query<{ provider: string; outcome: string }>(
      'SELECT provider, outcome FROM payment_charge_attempts ORDER BY created_at',
    );
    return c.json({ attempts: rows });
  });
}
