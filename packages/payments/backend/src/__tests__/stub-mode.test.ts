import { describe, expect, it, vi } from 'vitest';

import { settleActivationCharge } from '../activation/webhook';
import { credentialsForVerification } from '../activation/verify-charge';
import { createSettingsService, credentialStoreFrom } from '../config/service';
import type { StoredProviderConfig } from '../config/types';
import { createPaymentsGateway } from '../core/gateway';
import { defineProviders } from '../core/registry';
import { resolveStubMode, StubModeRefusedError, stubDeliveryTrusted } from '../core/stub-mode';
import type { MerchantRef, ResolvedCredentials, WebhookDelivery } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryProviderConfigStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';

/**
 * Stub mode is never inferred, and never available in production (FUT-696).
 *
 * The hole this closes: the deployment's answer to "may we fake payments?"
 * was read off an UNRELATED variable — a host computed
 * `allowStubMode = !process.env.PAGBANK_TOKEN`, i.e. "no PagBank token, so
 * this must be a laptop". A Stripe-only production deploy has no PagBank
 * token either, so its SANDBOX connections ran stubbed; and every webhook
 * verifier passes a delivery unconditionally in stub mode, because in stub
 * mode there is no secret to check. An anonymous POST to the PUBLIC webhook
 * endpoint therefore authenticated itself, named its own amount, and — with
 * `order_nsu=verify-<provider>-<tenantId>` — stamped the activation proof
 * that switches a provider on.
 *
 * The scenarios below are the ticket's, kept one-to-one:
 *   - "deploy de produção sem PagBank recusa webhook sem assinatura"
 *   - "POST anônimo jamais ativa um provedor"
 *   - "dev com PAYMENTS_STUB=1 mantém os fluxos de hoje"
 */

const TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };

/** The forged delivery from the ticket: no signature, no headers, no proof. */
const ANONYMOUS_POST: WebhookDelivery = {
  provider: 'infinitepay',
  rawBody: JSON.stringify({ order_nsu: `verify-infinitepay-${TENANT.id}`, amount: 101 }),
  headers: {},
};

/**
 * A connection row left behind by a deployment that once allowed stub mode —
 * a restored dev dump, a demo tenant on a shared database, or the very host
 * whose inference flipped when an unrelated credential appeared. The row is
 * the whole point: the write path refusing NEW stub rows does nothing about
 * the ones the webhook path already reads.
 */
function stubbedRow(provider: string): StoredProviderConfig {
  return {
    provider,
    enabled: true,
    priority: 0,
    environment: 'SANDBOX',
    status: 'VERIFIED',
    lastVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    chargeVerifiedAt: null,
    pendingVerification: null,
    expiresAt: null,
    stub: true,
    environments: { SANDBOX: {}, PRODUCTION: {} },
  };
}

/**
 * The public webhook endpoint's world, wired the way a host wires it: one
 * store, the real InfinitePay adapter, and the activation handler that stamps
 * `chargeVerifiedAt` — the thing an anonymous POST must never reach.
 */
async function webhookWorld(allowStubMode: boolean) {
  const store = createMemoryProviderConfigStore();
  await store.save(TENANT, stubbedRow('infinitepay'));
  const providers = defineProviders({ infinitepay: infinitePayProvider() } as const);
  const settings = createSettingsService(providers, store, { allowStubMode });
  const settled: string[] = [];
  const gateway = createPaymentsGateway({
    providers,
    credentials: credentialStoreFrom(store, { allowStubMode }),
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async (event, _charge, merchant) => {
      const reference = event.charge?.reference;
      if (!reference) return;
      if (await settleActivationCharge(settings, reference, merchant, event.provider)) {
        settled.push(reference);
      }
    },
  });
  return { gateway, store, settled };
}

describe('resolveStubMode — the explicit gate', () => {
  it('is OFF when nobody asked: an absent variable is not a permission', () => {
    expect(resolveStubMode({})).toBe(false);
    expect(resolveStubMode({ NODE_ENV: 'development' })).toBe(false);
  });

  it('is not inferred from other credentials being absent', () => {
    // The regression itself: whatever else the environment does or does not
    // carry, only PAYMENTS_STUB decides this.
    expect(resolveStubMode({ NODE_ENV: 'production' } as never)).toBe(false);
    expect(resolveStubMode({ PAYMENTS_STUB: '0' })).toBe(false);
    expect(resolveStubMode({ PAYMENTS_STUB: '' })).toBe(false);
  });

  it('turns on for an explicit PAYMENTS_STUB in a dev deployment', () => {
    expect(resolveStubMode({ PAYMENTS_STUB: '1', NODE_ENV: 'development' })).toBe(true);
    expect(resolveStubMode({ PAYMENTS_STUB: 'true' })).toBe(true);
    expect(resolveStubMode({ PAYMENTS_STUB: 'YES', NODE_ENV: 'test' })).toBe(true);
  });

  it('REFUSES production outright rather than quietly ignoring the variable', () => {
    // Hard refusal, at startup, while someone is still watching: a production
    // process carrying PAYMENTS_STUB is one NODE_ENV accident away from
    // charging nobody for real orders.
    expect(() => resolveStubMode({ PAYMENTS_STUB: '1', NODE_ENV: 'production' })).toThrow(
      StubModeRefusedError,
    );
  });
});

describe('stubDeliveryTrusted — the one condition every verifier shares', () => {
  const sandboxStub: ResolvedCredentials = { environment: 'SANDBOX', fields: {}, stub: true };
  const productionStub: ResolvedCredentials = {
    environment: 'PRODUCTION',
    fields: {},
    stub: true,
  };

  it('never trusts a PRODUCTION credential, whatever flag it carries', () => {
    expect(stubDeliveryTrusted(productionStub)).toBe(false);
    expect(stubDeliveryTrusted({ ...sandboxStub, stub: false })).toBe(false);
    expect(stubDeliveryTrusted(sandboxStub)).toBe(true);
  });

  it('is what every adapter with a secret-shaped verifier asks', async () => {
    const unsigned: WebhookDelivery = { provider: 'x', rawBody: '{}', headers: {} };
    const adapters = [stripeProvider(), stoneProvider(), pagbankProvider()];
    for (const adapter of adapters) {
      // No secret configured is the only way into the stub branch at all —
      // and a PRODUCTION connection must still fail closed there.
      await expect(adapter.webhook.verify(unsigned, productionStub)).resolves.toBe(false);
    }
  });
});

describe('a production deployment (stub mode never granted)', () => {
  it('refuses an unsigned webhook even on a connection row that says stub', async () => {
    // InfinitePay deliveries carry no signature by design, so `verify` re-asks
    // InfinitePay. Here it answers what it would about a payment nobody made.
    const calls = { fetch: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.fetch += 1;
        return new Response(JSON.stringify({ success: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const world = await webhookWorld(false);

    await expect(world.gateway.handleWebhook(TENANT, ANONYMOUS_POST)).rejects.toThrow(
      /verification/i,
    );

    // It went to InfinitePay instead of believing the body — the stub
    // short-circuit is gone, not merely outvoted.
    expect(calls.fetch).toBe(1);
    vi.unstubAllGlobals();
  });

  it('an anonymous POST stamps no chargeVerifiedAt and settles nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const world = await webhookWorld(false);

    await expect(world.gateway.handleWebhook(TENANT, ANONYMOUS_POST)).rejects.toThrow(Error);

    expect(world.settled).toEqual([]);
    expect((await world.store.get(TENANT, 'infinitepay'))?.chargeVerifiedAt).toBeNull();
    vi.unstubAllGlobals();
  });

  it('does not let a stale stub row resolve as stubbed on the read path', async () => {
    const rows = createMemoryProviderConfigStore();
    await rows.save(TENANT, stubbedRow('stone'));

    const production = credentialStoreFrom(rows);
    expect((await production.getCredentials(TENANT, 'stone'))?.stub).toBe(false);
    expect((await production.getConnectedCredentials?.(TENANT, 'stone'))?.stub).toBe(false);

    const dev = credentialStoreFrom(rows, { allowStubMode: true });
    expect((await dev.getCredentials(TENANT, 'stone'))?.stub).toBe(true);
  });

  it('does not let a stale stub row fake an activation charge either', async () => {
    const rows = createMemoryProviderConfigStore();
    await rows.save(TENANT, stubbedRow('stone'));
    const ctx = {
      providers: defineProviders({ stone: stoneProvider() } as const),
      config: rows,
      settings: {
        getPendingVerification: async () => null,
        setPendingVerification: async () => undefined,
      },
    };

    // A stubbed verification charge answers PAID without asking an acquirer
    // anything, and that pass is what earns `enabled: true`.
    expect((await credentialsForVerification(ctx, TENANT, 'stone'))?.stub).toBe(false);
    expect(
      (await credentialsForVerification({ ...ctx, allowStubMode: true }, TENANT, 'stone'))?.stub,
    ).toBe(true);
  });

  it('does not let a stale stub row fake "Testar conexão" either', async () => {
    // The probe is the third credential read, and the one most easily missed:
    // every adapter answers `{ ok: true, message: 'stub mode' }` the instant
    // `stub` is set, so reading the persisted column alone stamped VERIFIED on
    // a connection with nothing behind it — and for a provider that declares no
    // `activationCharge`, `requireProven` then lets the owner switch it on off
    // that fake pass and route real buyers to it.
    const calls = { fetch: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.fetch += 1;
        return new Response('{"message":"unauthorized"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const rows = createMemoryProviderConfigStore();
    const row = stubbedRow('stone');
    row.environments.SANDBOX = { secretKey: 'e2e-stub-token' };
    await rows.save(TENANT, row);
    const registry = defineProviders({ stone: stoneProvider() } as const);
    const strict = createSettingsService(registry, rows);

    const result = await strict.verify(TENANT, 'stone');

    // It asked Stone rather than believing the row, and wrote down what Stone
    // actually said about a key Stone refuses.
    expect(result.probe.ok).toBe(false);
    expect(calls.fetch).toBe(1);
    expect((await rows.get(TENANT, 'stone'))?.status).toBe('FAILED');
    vi.unstubAllGlobals();
  });
});

describe('a dev deployment with PAYMENTS_STUB=1', () => {
  it('keeps every flow it has today: the stub delivery still settles', async () => {
    // The counterpart of the two refusals above, on the SAME fixture: with the
    // gate explicitly granted, the stub short-circuit works exactly as before
    // and makes no network call at all.
    const calls = { fetch: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.fetch += 1;
        return new Response('{}', { status: 200 });
      }),
    );
    const world = await webhookWorld(true);

    await expect(world.gateway.handleWebhook(TENANT, ANONYMOUS_POST)).resolves.toHaveLength(1);

    expect(calls.fetch).toBe(0);
    expect(world.settled).toEqual([`verify-infinitepay-${TENANT.id}`]);
    vi.unstubAllGlobals();
  });

  it('still lets the probe short-circuit, which is what dev runs on', async () => {
    // The counterpart of the probe refusal above: granted the gate, "Testar
    // conexão" passes offline exactly as it did before, so a laptop with no
    // acquirer account keeps a working settings screen.
    const calls = { fetch: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.fetch += 1;
        return new Response('{}', { status: 200 });
      }),
    );
    const rows = createMemoryProviderConfigStore();
    await rows.save(TENANT, stubbedRow('stone'));
    const registry = defineProviders({ stone: stoneProvider() } as const);
    const dev = createSettingsService(registry, rows, { allowStubMode: true });

    const result = await dev.verify(TENANT, 'stone');

    expect(result.probe.ok).toBe(true);
    expect(calls.fetch).toBe(0);
    expect((await rows.get(TENANT, 'stone'))?.status).toBe('VERIFIED');
    vi.unstubAllGlobals();
  });
});
