/**
 * `@12-apps/payments-backend`'s merchant-admin surface, over the REAL tables.
 *
 * This is the first surface in this harness whose stores are the package's own
 * Prisma implementations rather than hand-written SQL, and that is the point:
 * the partial, the migrations and the shipped store meet in one place, which is
 * exactly where a plug-and-play schema breaks and exactly what the package's
 * own suite cannot cover (it generates against its own partial alone, in a
 * database only its own migration built).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { PAYMENTS_MOUNT_PATH } from '../src/payments-host';
import { FAILING_PROVIDER, PAYING_PROVIDER, PAYMENTS_MERCHANT } from '../src/payments-stores';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

const AT = '/api/admin/loja-harness/payments';

/** A request as the store's own admin. */
function asOwner(path: string, init: RequestInit = {}): Promise<Response> {
  return backend.app.request(`${AT}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-payments-merchant': 'loja-harness',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe('the settings surface, over the package own Prisma stores', () => {
  it('lists the providers this deployment routes over', async () => {
    const response = await asOwner('/settings');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { providers?: { provider: string }[] };
    const names = JSON.stringify(body);
    expect(names).toContain(PAYING_PROVIDER);
    expect(names).toContain(FAILING_PROVIDER);
  });

  it('saves credentials into the shipped table, encrypted', async () => {
    const saved = await asOwner(`/settings/providers/${PAYING_PROVIDER}`, {
      method: 'PUT',
      body: JSON.stringify({
        environment: 'SANDBOX',
        fields: { apiKey: 'sk_harness_1' },
      }),
    });

    expect(saved.status).toBe(200);
    // The row is REAL, and the blob must be opaque: a stored secret sitting
    // there in the clear is the failure mode a cipher exists to prevent, and
    // the response alone (masked either way) cannot see it.
    const stored = await backend.app.request(
      `/__harness/payments/stored-credentials?provider=${PAYING_PROVIDER}`,
    );
    const { rows } = (await stored.json()) as { rows: string[] };
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain('sk_harness_1');
  });

  it('refuses a caller the host gate turned away, before any handler', async () => {
    const refused = await asOwner('/settings', { headers: { 'x-payments-gate': 'deny' } });

    expect(refused.status).toBe(403);
  });
});

describe('the failover walk, over the shipped tables', () => {
  /** Save credentials, prove the connection, and join the chain — in that order. */
  async function connect(provider: string): Promise<void> {
    const { settings } = backend.hosts.payments.stores;
    await asOwner(`/settings/providers/${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ environment: 'SANDBOX', fields: { apiKey: `sk_${provider}` } }),
    });
    // The ONLY door to `enabled: true` (FUT-463): a connection joins the chain
    // by having charged, never by an owner ticking a box. The host settles that
    // from its own verification charge, which is why it is a service call here
    // rather than a request.
    await settings.applyChargeVerification(PAYMENTS_MERCHANT, provider, true);
  }

  it('walks past a technical failure and settles on the next provider', async () => {
    // The chain is `corrente` (unreachable) then `cascata` (pays), in the order
    // enabling put them: enabling appends LAST, so this order is a fact about
    // the two calls below rather than something the test asserted into place.
    await connect(FAILING_PROVIDER);
    await connect(PAYING_PROVIDER);

    const stored = await backend.hosts.payments.stores.gateway.charge(PAYMENTS_MERCHANT, {
      amount: { amountCents: 2500, currency: 'BRL' },
      method: 'PIX',
      reference: 'pedido-harness-1',
      idempotencyKey: 'idem-harness-1',
      customer: { name: 'Ana Harness', email: 'ana@harness.dev' },
    } as never);

    expect(stored.snapshot.status).toBe('PAID');
    expect(stored.snapshot.provider).toBe(PAYING_PROVIDER);

    // The audit trail is REAL rows in the package's own table: both attempts,
    // the refusal and the settlement. It is load-bearing rather than
    // observational — a retried charge reads its own prior attempts and resumes
    // after them instead of re-hitting a provider that already refused.
    const trail = await backend.app.request('/__harness/payments/attempts');
    const { attempts } = (await trail.json()) as { attempts: { provider: string }[] };
    expect(attempts.map((attempt) => attempt.provider)).toEqual([
      FAILING_PROVIDER,
      PAYING_PROVIDER,
    ]);
  });
});

describe('adopted through @12-apps/wiring, not by calling the mount', () => {
  it('counts every row a catch-all could not', () => {
    // `mountPayments` is a dispatcher behind ONE catch-all, so a host mounting
    // it directly has no way to say which endpoints it serves — and an endpoint
    // nobody claimed is a silent 404. The wire view answers one descriptor per
    // served row, which is what makes the aggregate able to report the surface.
    const paths = backend.hosts.payments.routes.map((mounted) => mounted.route.path);

    expect(paths.length).toBeGreaterThan(5);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('marks the provider callback a WEBHOOK, so nothing gates it', () => {
    // A callback verified by signature has no caller to resolve. Gating it
    // would refuse every settlement notice the acquirer sends — and the bridge
    // honours the mark rather than 401ing on a null actor (#454).
    const webhook = backend.hosts.payments.routes.find(
      (mounted) => (mounted.route as { kind?: string }).kind === 'webhook',
    );

    expect(webhook).toBeDefined();
    expect(webhook?.route.method).toBe('POST');
  });

  it("binds the package's OWN blueprints — four sweeps, their cadences declared", () => {
    const names = backend.hosts.payments.jobs.map((job) => job.name);

    expect(names).toContain('payments.reconcile-pending');
    expect(names).toContain('payments.webhook-drain');
    // Every cadence is the package's claim about its own domain; a host that
    // restated them in its own `defineJob` would own numbers it cannot answer
    // questions about.
    backend.hosts.payments.jobs.forEach((job) => {
      expect(job.schedule ?? job.interval).toBeDefined();
    });
  });

  it('accounts for every capability, with none unanswered', () => {
    const statuses = new Map(
      backend.hosts.payments.report.packages[0]?.capabilities.map((entry) => [
        entry.kind,
        entry.status,
      ]),
    );

    expect(statuses.get('http')).toBe('bound');
    expect(statuses.get('jobs')).toBe('bound');
    expect(statuses.get('email')).toBe('bound');
    expect(statuses.get('db')).toBe('collected');
    expect(statuses.get('observability')).toBe('bound');
    expect([...statuses.values()]).not.toContain('unanswered');
    expect([...statuses.values()]).not.toContain('unbound');
  });

  it('names a row this host forgot to claim', () => {
    const { routes } = backend.hosts.payments;
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${PAYMENTS_MOUNT_PATH}${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.hosts.payments.report)).toContain(
      `http: bound — ${backend.hosts.payments.routes.length} routes at ${PAYMENTS_MOUNT_PATH}`,
    );
  });
});
