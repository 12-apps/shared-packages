import { describe, expect, it, vi } from 'vitest';

import { buyerCheckoutConfig } from '../checkout/config';
import { createSettingsService, credentialStoreFrom } from '../config/service';
import { createChargeRaiser } from '../core/charge-raise';
import { UnsupportedOperationError, WebhookVerificationError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import { ManualChargeNotFoundError, ManualChargeNotPendingError } from '../core/manual-charge';
import type { WebhookEventHandler } from '../core/ports';
import { defineProviders } from '../core/registry';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryProviderConfigStore } from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { infinitePayProvider } from '../providers/infinitepay';
import { itauProvider } from '../providers/itau';
import { PT_BR_PIX_MANUAL_COPY } from '../providers/pix-manual/pt-BR';
import { pixManualProvider } from '../providers/pixmanual';
import { PT_BR_INFINITEPAY_COPY, PT_BR_ITAU_COPY } from '../providers/pt-BR';
import { TENANT, cardInput, pixInput } from './fixtures';

/**
 * A charge only the store can settle, end to end through the REAL gateway:
 * confirm, refuse and expire are each one compare-and-set, a confirmation
 * reaches the host through the same handler a webhook does, and reading the
 * charge never writes it.
 */

const CONFIGURED = { pixKey: 'loja@example.com', merchantName: 'Padaria Boa', merchantCity: 'Recife' };

type Chain = ReadonlyArray<'pixmanual' | 'itau' | 'infinitepay'>;

async function store(chain: Chain = ['pixmanual'], onWebhookEvent?: WebhookEventHandler) {
  const configStore = createMemoryProviderConfigStore();
  const providers = defineProviders({
    pixmanual: pixManualProvider(PT_BR_PIX_MANUAL_COPY),
    itau: itauProvider(PT_BR_ITAU_COPY),
    infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  } as const);
  const settings = createSettingsService(providers, configStore, { allowStubMode: true });
  const charges = createMemoryChargeStore();
  const attempts = createMemoryAttemptLedger();
  const credentials = credentialStoreFrom(configStore, { allowStubMode: true });
  const handler = onWebhookEvent ?? vi.fn<WebhookEventHandler>(async () => undefined);
  const gateway = createPaymentsGateway({
    providers,
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
    onWebhookEvent: handler,
  });
  for (const name of chain) {
    // Pix manual has no sandbox (every code is real money); the stubbed vendors run in theirs.
    await settings.saveCredentials(TENANT, name, {
      environment: name === 'pixmanual' ? 'PRODUCTION' : 'SANDBOX',
      fields: name === 'pixmanual' ? CONFIGURED : {},
    });
    if (name === 'infinitepay') await settings.applyChargeVerification(TENANT, name, true);
    else await settings.setEnabled(TENANT, name, true);
  }
  await settings.setPriorities(TENANT, [...chain]);
  return { gateway, charges, attempts, handler, providers, configStore, credentials };
}

async function raisedPix(world: Awaited<ReturnType<typeof store>>, reference = 'order-1') {
  const stored = await world.gateway.charge(TENANT, pixInput(reference));
  return stored.snapshot.providerChargeId;
}

describe('confirmManualCharge', () => {
  it('moves PENDING to PAID at the stored amount and settles through the host webhook handler', async () => {
    const world = await store();
    const id = await raisedPix(world);

    const confirmed = await world.gateway.confirmManualCharge(TENANT, 'pixmanual', id);

    expect(confirmed.snapshot.status).toBe('PAID');
    expect(confirmed.snapshot.amount).toEqual(pixInput('x').amount);
    expect(world.handler).toHaveBeenCalledTimes(1);
    const [event, charge] = vi.mocked(world.handler).mock.calls[0] ?? [];
    expect(event).toMatchObject({ type: 'CHARGE_UPDATED', eventId: `manual-confirm:${id}`, charge: { status: 'PAID' } });
    expect(charge?.snapshot.status).toBe('PAID');
  });

  it('re-runs the handler over a charge already PAID — the recovery when settling failed', async () => {
    const failOnce = vi.fn<WebhookEventHandler>().mockRejectedValueOnce(new Error('db blip')).mockResolvedValue(undefined);
    const world = await store(['pixmanual'], failOnce);
    const id = await raisedPix(world);

    await expect(world.gateway.confirmManualCharge(TENANT, 'pixmanual', id)).rejects.toThrow('db blip');
    const retried = await world.gateway.confirmManualCharge(TENANT, 'pixmanual', id);

    expect(retried.snapshot.status).toBe('PAID');
    expect(failOnce).toHaveBeenCalledTimes(2);
  });

  it('refuses a charge already refused or expired, and never calls the handler', async () => {
    const world = await store();
    const refused = await raisedPix(world, 'order-r');
    const expired = await raisedPix(world, 'order-e');
    await world.gateway.refuseManualCharge(TENANT, 'pixmanual', refused);
    await world.gateway.expireManualCharge(TENANT, 'pixmanual', expired);

    await expect(world.gateway.confirmManualCharge(TENANT, 'pixmanual', refused)).rejects.toBeInstanceOf(ManualChargeNotPendingError);
    await expect(world.gateway.confirmManualCharge(TENANT, 'pixmanual', expired)).rejects.toBeInstanceOf(ManualChargeNotPendingError);
    expect(world.handler).not.toHaveBeenCalled();
  });

  it('lets exactly one of a concurrent confirm and refuse win', async () => {
    const world = await store();
    const id = await raisedPix(world);

    const [confirm, refuse] = await Promise.allSettled([
      world.gateway.confirmManualCharge(TENANT, 'pixmanual', id),
      world.gateway.refuseManualCharge(TENANT, 'pixmanual', id),
    ]);

    expect([confirm.status, refuse.status].sort()).toEqual(['fulfilled', 'rejected']);
    const final = await world.charges.findByProviderChargeId('pixmanual', id);
    expect(final?.snapshot.status).toBe(confirm.status === 'fulfilled' ? 'PAID' : 'CANCELED');
  });

  it('refuses a provider the store does not confirm by hand, and an unknown charge', async () => {
    const world = await store(['pixmanual', 'itau']);

    await expect(world.gateway.confirmManualCharge(TENANT, 'itau', 'any')).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(world.gateway.confirmManualCharge(TENANT, 'pixmanual', 'pixmanual_nope')).rejects.toBeInstanceOf(
      ManualChargeNotFoundError,
    );
  });

  it('refuses a charge that belongs to another merchant', async () => {
    const world = await store();
    const id = await raisedPix(world);

    await expect(
      world.gateway.confirmManualCharge({ kind: 'TENANT', id: 'someone-else' }, 'pixmanual', id),
    ).rejects.toBeInstanceOf(ManualChargeNotFoundError);
  });
});

describe('refuseManualCharge and expireManualCharge', () => {
  it('close a PENDING charge and are idempotent over a closed one', async () => {
    const world = await store();
    const id = await raisedPix(world);

    const refused = await world.gateway.refuseManualCharge(TENANT, 'pixmanual', id);
    const again = await world.gateway.expireManualCharge(TENANT, 'pixmanual', id);

    expect(refused.snapshot.status).toBe('CANCELED');
    expect(again.snapshot.status).toBe('CANCELED');
  });

  it('refuse to close a charge the store already confirmed — the host must not abandon it', async () => {
    const world = await store();
    const id = await raisedPix(world);
    await world.gateway.confirmManualCharge(TENANT, 'pixmanual', id);

    await expect(world.gateway.refuseManualCharge(TENANT, 'pixmanual', id)).rejects.toBeInstanceOf(ManualChargeNotPendingError);
    await expect(world.gateway.expireManualCharge(TENANT, 'pixmanual', id)).rejects.toBeInstanceOf(ManualChargeNotPendingError);
  });
});

describe('refreshCharge on a manual charge', () => {
  it('answers the stored snapshot and never writes, so a concurrent confirm keeps its PAID', async () => {
    const world = await store();
    const id = await raisedPix(world);

    const [refreshed] = await Promise.all([
      world.gateway.refreshCharge(TENANT, 'pixmanual', id),
      world.gateway.confirmManualCharge(TENANT, 'pixmanual', id),
    ]);

    expect(['PENDING', 'PAID']).toContain(refreshed.status);
    expect((await world.charges.findByProviderChargeId('pixmanual', id))?.snapshot.status).toBe('PAID');
    expect((await world.gateway.refreshCharge(TENANT, 'pixmanual', id)).status).toBe('PAID');
  });

  it('throws not-found for a charge it never raised rather than asking the adapter', async () => {
    const world = await store();

    await expect(world.gateway.refreshCharge(TENANT, 'pixmanual', 'pixmanual_nope')).rejects.toBeInstanceOf(
      ManualChargeNotFoundError,
    );
  });
});

describe('the public webhook route', () => {
  it('refuses a delivery for pixmanual — a confirmation cannot be forged from outside', async () => {
    const world = await store();
    const id = await raisedPix(world);

    await expect(
      world.gateway.handleWebhook(TENANT, {
        provider: 'pixmanual',
        rawBody: JSON.stringify({ providerChargeId: id, status: 'PAID' }),
        headers: {},
      }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    expect((await world.charges.findByProviderChargeId('pixmanual', id))?.snapshot.status).toBe('PENDING');
  });
});

describe('a chain with Pix manual in it', () => {
  it('takes PIX at Pix manual and hands a card to the card provider behind it', async () => {
    const world = await store(['pixmanual', 'infinitepay']);

    const pix = await world.gateway.charge(TENANT, pixInput('order-pix'));
    const card = await world.gateway.charge(TENANT, cardInput('order-card'));

    expect(pix.snapshot.provider).toBe('pixmanual');
    expect(card.snapshot.provider).toBe('infinitepay');
  });

  it('lets the priority decide between Itaú and Pix manual', async () => {
    const itauFirst = await store(['itau', 'pixmanual']);
    const manualFirst = await store(['pixmanual', 'itau']);

    expect((await itauFirst.gateway.charge(TENANT, pixInput('a'))).snapshot.provider).toBe('itau');
    expect((await manualFirst.gateway.charge(TENANT, pixInput('b'))).snapshot.provider).toBe('pixmanual');
  });
});

describe('a provider with no sandbox', () => {
  it('refuses a save into the environment it does not have', async () => {
    const configStore = createMemoryProviderConfigStore();
    const providers = defineProviders({ pixmanual: pixManualProvider(PT_BR_PIX_MANUAL_COPY) } as const);
    const service = createSettingsService(providers, configStore, { allowStubMode: true });

    await expect(
      service.saveCredentials(TENANT, 'pixmanual', { environment: 'SANDBOX', fields: CONFIGURED }),
    ).rejects.toThrow(/no SANDBOX environment/);
  });
});

describe('automatic-only charging, for a lane nobody watches', () => {
  it('leaves Pix manual out of the walk and records no attempt for it', async () => {
    const world = await store(['pixmanual', 'itau']);

    const stored = await world.gateway.charge(TENANT, pixInput('market-1'), { confirmation: 'AUTOMATIC' });

    expect(stored.snapshot.provider).toBe('itau');
    expect(world.attempts.all().filter((a) => a.reference === 'market-1').map((a) => a.provider)).toEqual(['itau']);
  });

  it('carries the option through createChargeRaiser, the path hosts raise charges on', async () => {
    const world = await store(['pixmanual', 'itau']);
    const raise = createChargeRaiser({
      gateway: world.gateway,
      charges: world.charges,
      log: { warn: () => undefined, error: () => undefined },
    });

    const raised = await raise({
      merchant: TENANT,
      reference: 'market-2',
      amount: pixInput('x').amount,
      method: 'PIX',
      customer: {},
      confirmation: 'AUTOMATIC',
    });

    expect(raised.provider).toBe('itau');
  });

  it('refuses a store whose only provider is Pix manual, honestly', async () => {
    const world = await store(['pixmanual']);

    await expect(world.gateway.charge(TENANT, pixInput('market-3'), { confirmation: 'AUTOMATIC' })).rejects.toThrow(
      /No payment provider/,
    );
  });

  it('leaves Pix manual out of the buyer chain, and publishes who confirms on each link', async () => {
    const world = await store(['pixmanual', 'itau']);
    const deps = { gateway: world.gateway, providers: world.providers, connections: world.configStore, credentials: world.credentials };

    const everyone = await buyerCheckoutConfig(deps, TENANT);
    const market = await buyerCheckoutConfig(deps, TENANT, { confirmation: 'AUTOMATIC' });

    expect(everyone.chain.map((link) => [link.provider, link.confirmation])).toEqual([
      ['pixmanual', 'MANUAL'],
      ['itau', 'AUTOMATIC'],
    ]);
    expect(market.chain.map((link) => link.provider)).toEqual(['itau']);
  });
});
