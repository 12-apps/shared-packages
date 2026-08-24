/**
 * The host half of `@12-apps/billing/server` — the card-on-file surface, and
 * every decision the package refuses to make.
 *
 * Four endpoints over one flow: read the cards, open a vault session, finish
 * one, take them all off file. What is genuinely this host's:
 *
 * - **The guard.** Nothing in the package authenticates anybody; it takes a
 *   resolved owner as its actor. Here that is a header, as everywhere else in
 *   this harness — a real host resolves a session.
 * - **Every sentence, and every status.** `copy` is REQUIRED and ships no
 *   defaults, and `createApiBilling` THROWS naming each missing field. That is
 *   the contract worth adopting against: "a default in the origin platform's
 *   language reads as finished to the next one right up until it reaches a
 *   user", and the status codes travel with the sentences because "is an
 *   unconfigured platform a 503 or a 501" is the same kind of decision.
 * - **The tables.** The package ships no `db` contribution at all; see
 *   `billing-db.ts` for why, and for the three ports that reach them.
 * - **The merchant.** The platform's own account, stated once rather than
 *   resolved per call — see `PLATFORM_MERCHANT`.
 */
import type { PGlite } from '@electric-sql/pglite';
import { billingManifest } from '@12-apps/billing/manifest';
import { billingServerManifest } from '@12-apps/billing/manifest/server';
import type { BillingApiCopy } from '@12-apps/billing/server';
import { ProviderRequestError } from '@12-apps/payments-backend';
import type { MountedRoute, WireRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import type { Hono } from 'hono';

import { applyBillingSchema, instrumentStore, subscriptionDirectory } from './billing-db';
import { createBillingPayments, PLATFORM_MERCHANT } from './billing-payments';
import { Params, type SqlRunner } from './rbac-db-shared';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** Where the four routes hang. Self-scoped: a card on file is the OWNER's. */
export const BILLING_MOUNT_PATH = '/api/account/billing';

/** The header this harness resolves the owner from — the rbac host's convention. */
export const BILLING_OWNER_HEADER = 'x-rbac-user';

export const BILLING_OWNER = 'ana';
export const BILLING_OWNER_B = 'bruno';

/**
 * The host's own words, and its own status codes.
 *
 * pt-BR because this harness is, and every one of them is a sentence an
 * operator or a subscriber actually reads. The two 503s and the 409 are the
 * host's judgement rather than the package's: an unconfigured platform is a
 * temporary condition an operator fixes, while a subscriber with no
 * subscription is a request that does not make sense.
 */
export const BILLING_COPY: BillingApiCopy = {
  rejections: {
    'no-platform-account': {
      status: 503,
      message: 'A cobrança ainda não está configurada nesta plataforma. Tente mais tarde.',
    },
    'no-subscription': {
      status: 409,
      message: 'Não há assinatura para associar um cartão.',
    },
    'provider-cannot-vault': {
      status: 503,
      message: 'O meio de pagamento atual não permite guardar cartão. Fale com o suporte.',
    },
  },
  detachFailed: {
    status: 503,
    message: 'Não conseguimos remover o cartão agora. Tente de novo em instantes.',
  },
  invalidSession: {
    status: 400,
    message: 'A sessão de cartão é inválida. Recomece o cadastro.',
  },
};

/**
 * The provider refused, and this host is where that becomes a sentence.
 *
 * `createApiBilling` maps its OWN rejections to copy and lets a provider error
 * through — deliberately, and its docblock says so: "an adapter can map any
 * 4xx/5xx from this surface onto its own error type". The adapter it means is
 * this one. Without it a refused session is an unhandled throw, which the
 * bridge answers as a bare 500 with no words in it — and the refusal that
 * matters most here is the one an attacker provokes, by posting somebody
 * else's session id.
 *
 * A non-retriable provider refusal is the CALLER's problem (400); a retriable
 * one is the provider's (503), and telling a subscriber to try again is only
 * honest in the second case.
 */
function mapProviderError(error: unknown): { status: number; body: { message: string } } | null {
  if (!(error instanceof ProviderRequestError)) return null;
  return error.retriable
    ? {
        status: 503,
        body: { message: 'O meio de pagamento não respondeu. Tente de novo em instantes.' },
      }
    : {
        status: 400,
        body: { message: 'Não foi possível guardar este cartão. Recomece o cadastro.' },
      };
}

/**
 * Whether this deployment can collect at all.
 *
 * Checked FIRST and EARLY by every server-side factory, so a deployment with
 * no platform account does nothing quietly rather than raising a charge that
 * throws deep inside the gateway once per customer. Held in a container a
 * suite flips, because "the platform has no account" is a state a host cannot
 * provoke from outside.
 */
export const billingPlatform = {
  enabled: true,
  reset(): void {
    billingPlatform.enabled = true;
  },
};

/** One route with this host's provider-error mapping wrapped around it. */
function guarded(route: WireRoute<never>): WireRoute<never> {
  return {
    ...route,
    handle: async (request) => {
      try {
        return await route.handle(request);
      } catch (error) {
        const mapped = mapProviderError(error);
        if (!mapped) throw error;
        return mapped;
      }
    },
  };
}

export interface HarnessBilling {
  router: Hono;
  payments: ReturnType<typeof createBillingPayments>;
  /** The consumer's own account of what was bound, declined or left over. */
  report: WiringReport;
  routes: readonly MountedRoute[];
}

/**
 * The surface, adopted through `@12-apps/wiring/consumer` — never by calling
 * `createApiBilling` directly.
 *
 * Calling the factory by hand is the failure the contract was written to stop:
 * "a version bump that adds a capability arrives silently — report-builder 5.x
 * shipped three working-copy endpoints its own client calls, and the origin
 * host never mounted them; the editor's autosave 404s and nothing is red."
 *
 * Two of this package's declarations are ones a hand-mount drops in exactly
 * that silent way:
 *
 * - **`observability: { namespace: 'billing' }`**, which the manifest marks
 *   MANDATORY for runtime manifests and gives the reason for: "the money path
 *   is the one place where 'it failed and filed nowhere' is unaffordable, so
 *   the binder hands this package a logger already scoped to `billing`."
 *   `createApiBilling` takes no logger argument — the BINDER supplies it. A
 *   host that called the factory itself would ship a money path filing
 *   nowhere, and nothing would say so.
 * - **the inventory.** The shared manifest inventories the runtime manifests,
 *   so the day billing declares `jobs` — the cycle collector is already in
 *   `./server`, unmounted here — this host's `assemble()` goes RED naming the
 *   capability instead of quietly not running it.
 *
 * Every declared capability is therefore bound or DECLINED WITH A REASON.
 * Silence is what throws.
 */
export function billingHost(pg: PGlite): HarnessBilling {
  const sql = pg as unknown as SqlRunner;
  const payments = createBillingPayments();

  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    // The port behind the mandatory namespace above. This harness's sink is
    // the console; a real host hands `createFeatureLogger` here.
    ports: { loggerFor: harnessLoggerFor },
  });

  host.adoptServer({
    manifest: billingManifest,
    server: billingServerManifest,
    bindings: {
      http: {
        mountPath: BILLING_MOUNT_PATH,
        config: {
          subscriptions: subscriptionDirectory(sql),
          instruments: instrumentStore(sql),
          merchant: PLATFORM_MERCHANT,
          enabled: async () => billingPlatform.enabled,
          // A promise-returning accessor rather than the built object: a real
          // host builds its gateway lazily over a database client it also
          // builds lazily, and a package demanding it at construction would
          // force the whole payment stack to exist before the first request
          // that needs it.
          payments: async () => ({
            gateway: payments.gateway,
            credentials: payments.credentials,
          }),
          copy: BILLING_COPY,
        },
      },
    },
  });

  const wired = host.assemble();

  return {
    payments,
    report: wired.report,
    routes: wired.routes,
    // The host's ONE bridge, over the ASSEMBLED routes. What this adoption adds
    // around them is the provider-error mapping above — the one thing the
    // package hands back rather than answering itself.
    router: honoRouterFor(
      wired.routes.map(
        (mounted) => ({ route: guarded(mounted.route as WireRoute<never>) }) as never,
      ),
      (c) => {
        const ownerId = c.req.header(BILLING_OWNER_HEADER);
        return ownerId ? { ownerId } : null;
      },
    ),
  };
}

/** The host's schema, then two subscribers. */
export async function provisionBilling(pg: PGlite): Promise<HarnessBilling> {
  await applyBillingSchema(pg);
  await reseedBilling(pg);
  return billingHost(pg);
}

/**
 * Two owners, each with their own subscription.
 *
 * Two rather than one because the property this surface exists to hold is
 * about the SECOND owner: a session minted for one subscription must not
 * complete against another, and one owner's removal must not touch the other's
 * rows. Neither is observable with a single subscriber.
 */
export async function reseedBilling(pg: PGlite): Promise<void> {
  billingPlatform.reset();
  await pg.exec(`DELETE FROM billing_instruments; DELETE FROM billing_subscriptions;`);
  const sql = pg as unknown as SqlRunner;
  for (const [ownerId, name] of [
    [BILLING_OWNER, 'Ana Ferreira'],
    [BILLING_OWNER_B, 'Bruno Lima'],
  ]) {
    const params = new Params();
    await sql.query(
      `INSERT INTO billing_subscriptions (id, owner_id, plan_key, email, name)
       VALUES (${params.add(`sub-${ownerId}`)}, ${params.add(ownerId)}, 'feature',
               ${params.add(`${ownerId}@exemplo.invalid`)}, ${params.add(name)})`,
      params.values,
    );
  }
}
