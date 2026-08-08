import { describe, expect, it, vi } from 'vitest';

import {
  CredentialsError,
  UnsupportedOperationError,
  WebhookVerificationError,
} from '../core/errors';
import {
  OTHER_TENANT,
  STUB_CREDS,
  TENANT,
  UNUSED_VAULT_STEPS,
  cardInput,
  pixInput,
  setupBridgedGatewayWorld,
  setupCancellingWorld,
  setupGatewayWorld,
  setupVaultingWorld,
  stoneDelivery,
} from './fixtures';

describe('createPaymentsGateway', () => {
  it('charges via the merchant default provider and persists the snapshot', async () => {
    const world = setupGatewayWorld();
    const stored = await world.gateway.charge(TENANT, pixInput());
    expect(stored.provider).toBe('stone');
    expect(stored.snapshot.status).toBe('PENDING');
    expect(stored.snapshot.pix?.qrText).toContain('stub-pix');
    expect(world.charges.all()).toHaveLength(1);
  });

  it('returns the SAME charge for a repeated idempotency key', async () => {
    const world = setupGatewayWorld();
    const input = { ...pixInput(), idempotencyKey: 'order-1:1' };
    const first = await world.gateway.charge(TENANT, input);
    const second = await world.gateway.charge(TENANT, input);
    expect(second.id).toBe(first.id);
    expect(world.charges.all()).toHaveLength(1);
  });

  it('coalesces same-process concurrent charges with one key into ONE provider call', async () => {
    const world = setupGatewayWorld();
    const createSpy = vi.spyOn(world.adapter, 'createCharge');
    const input = { ...pixInput('order-race'), idempotencyKey: 'race:1' };
    const [a, b] = await Promise.all([
      world.gateway.charge(TENANT, input),
      world.gateway.charge(TENANT, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a stub charge-id collision across merchants instead of sharing the row', async () => {
    const world = setupGatewayWorld();
    world.credentials.set(OTHER_TENANT, 'stone', STUB_CREDS);
    await world.gateway.charge(TENANT, pixInput('order-1'));
    // Same provider + same reference in stub mode → same deterministic
    // providerChargeId. The store must refuse, never return tenant-1's row.
    await expect(world.gateway.charge(OTHER_TENANT, pixInput('order-1'))).rejects.toThrow(
      /another merchant/,
    );
  });

  it('scopes idempotency keys to the merchant — no cross-tenant reuse', async () => {
    const world = setupGatewayWorld();
    world.credentials.set(OTHER_TENANT, 'stone', STUB_CREDS);
    const first = await world.gateway.charge(TENANT, {
      ...pixInput('order-a'),
      idempotencyKey: 'k1',
    });
    const second = await world.gateway.charge(OTHER_TENANT, {
      ...pixInput('order-b'),
      idempotencyKey: 'k1',
    });
    // Same key string, different merchants: two distinct charges, and
    // neither merchant ever sees the other's snapshot.
    expect(second.id).not.toBe(first.id);
    expect(world.charges.all()).toHaveLength(2);
  });

  it('never collides (merchant, key) tuples that concatenate identically', async () => {
    // merchant "tenant:1" + key "k1" vs merchant "tenant" + key "1:k1" would
    // collapse under naive `${id}:${key}` encoding; tuple keys keep them apart.
    const world = setupGatewayWorld();
    const trickyA = { kind: 'TENANT', id: 'tenant:1' } as const;
    const trickyB = { kind: 'TENANT', id: 'tenant' } as const;
    world.credentials.set(trickyA, 'stone', STUB_CREDS);
    world.credentials.set(trickyB, 'stone', STUB_CREDS);
    const [a, b] = await Promise.all([
      world.gateway.charge(trickyA, { ...pixInput('order-a'), idempotencyKey: 'k1' }),
      world.gateway.charge(trickyB, { ...pixInput('order-b'), idempotencyKey: '1:k1' }),
    ]);
    expect(a.id).not.toBe(b.id);
    expect(world.charges.all()).toHaveLength(2);
  });

  it('refuses a merchant with no configured provider', async () => {
    const world = setupGatewayWorld();
    await expect(
      world.gateway.charge({ kind: 'TENANT', id: 'unconnected' }, pixInput()),
    ).rejects.toThrow(CredentialsError);
  });

  it('gates unsupported methods uniformly before calling the adapter', async () => {
    const world = setupGatewayWorld();
    world.credentials.set(TENANT, 'infinitepay', STUB_CREDS);
    await expect(
      world.gateway.charge(TENANT, { ...pixInput(), method: 'BOLETO' }, { provider: 'infinitepay' }),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('gates partial refunds by capability', async () => {
    const world = setupGatewayWorld();
    world.credentials.set(TENANT, 'infinitepay', STUB_CREDS);
    await expect(
      world.gateway.refund(TENANT, 'infinitepay', {
        providerChargeId: 'x',
        amount: { amountCents: 100, currency: 'BRL' },
      }),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('refuses to vault on a provider that cannot save a card (FUT-340)', async () => {
    // Stone has no `vault`, and the honest answer is a typed refusal rather
    // than a substitution: the providers that cannot save a card without
    // taking money would do so by charging somebody to store it, and an
    // instrument minted elsewhere is unreadable to the acquirer we collect
    // through anyway.
    const world = setupGatewayWorld();

    await expect(
      world.gateway.beginVault(TENANT, {
        reference: 'sub-1',
        customer: { name: 'Loja', email: 'l@x.com' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('refuses to FORGET a card on a provider that cannot detach one (FUT-340)', async () => {
    // "Can save a card" and "can un-save one" are separate facts about a
    // vendor. A gateway that inferred the second from the first would report a
    // removal that never happened, and the card would stay on file at the
    // provider with nobody aware of it.
    const world = setupVaultingWorld({ ...UNUSED_VAULT_STEPS });

    await expect(
      world.gateway.forgetVault(TENANT, 'vaulting', { instrumentId: 'pm_1' }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('forgets at the NAMED provider, not the merchant’s active one', async () => {
    // The one asymmetry between saving a card and removing it. An instrument
    // belongs to the provider that minted it, so after an acquirer switch the
    // card to detach sits at YESTERDAY's provider — resolving today's would
    // send a `pm_` to an acquirer that has never heard of it and then call the
    // resulting rejection a removal.
    const forget = vi.fn(() => Promise.resolve());
    const world = setupVaultingWorld({ ...UNUSED_VAULT_STEPS, forget });
    world.credentials.set(TENANT, 'vaulting', STUB_CREDS);

    await world.gateway.forgetVault(TENANT, 'vaulting', { instrumentId: 'pm_1' });

    expect(forget).toHaveBeenCalledWith({ instrumentId: 'pm_1' }, STUB_CREDS);
  });

  it('refuses to forget on a provider that is no longer connected', async () => {
    // Not a silent success: a provider we cannot authenticate against still
    // holds the card, and only the HOST can weigh dropping its pointer anyway
    // against leaving the tenant unable to remove anything.
    const forget = vi.fn(() => Promise.resolve());
    const world = setupVaultingWorld({ ...UNUSED_VAULT_STEPS, forget });

    await expect(
      world.gateway.forgetVault(TENANT, 'vaulting', { instrumentId: 'pm_1' }),
    ).rejects.toBeInstanceOf(CredentialsError);
    expect(forget).not.toHaveBeenCalled();
  });

  /**
   * The gateway wired the way a HOST wires it — through `credentialStoreFrom`
   * over stored config rows — so a row's status can decide routing (FUT-683).
   * The raw memory credential store the other tests use has no status at all.
   */
  describe('routing around a dead grant (FUT-683)', () => {
    async function bridgedWorldWithChain() {
      const world = setupBridgedGatewayWorld();
      for (const provider of ['primary', 'backup'] as const) {
        await world.settings.saveCredentials(TENANT, provider, {
          environment: 'SANDBOX',
          fields: {},
        });
        await world.settings.applyChargeVerification(TENANT, provider, true);
      }
      return world;
    }

    async function killGrant(world: Awaited<ReturnType<typeof bridgedWorldWithChain>>) {
      // What a refused refresh records — see `refreshConnect`: status flips,
      // `enabled` deliberately does not.
      const primary = await world.configStore.get(TENANT, 'primary');
      await world.configStore.save(TENANT, { ...primary!, status: 'RECONNECT_REQUIRED' });
    }

    it('given the head grant is dead, when a charge is raised, then it lands on the healthy second provider', async () => {
      const world = await bridgedWorldWithChain();
      await killGrant(world);

      // Straight to `backup` as chain[0] — not a failover bounce off a 401
      // against the token the provider already refused.
      const stored = await world.gateway.charge(TENANT, pixInput());
      expect(stored.provider).toBe('backup');
    });

    it('given an only-provider store whose grant is dead, then a charge finds no provider at all', async () => {
      const world = setupBridgedGatewayWorld();
      await world.settings.saveCredentials(TENANT, 'primary', {
        environment: 'SANDBOX',
        fields: {},
      });
      await world.settings.applyChargeVerification(TENANT, 'primary', true);
      await killGrant(world);

      // The same refusal an unconfigured store gets — which upstream is the
      // storefront's "payments unavailable", not a generic charge error.
      await expect(world.gateway.charge(TENANT, pixInput())).rejects.toThrow(
        /No payment provider configured/,
      );
    });
  });

  describe('cancelCharge (FUT-379)', () => {
    /** A provider that voids, answering with the CANCELED snapshot. */
    function voided(providerChargeId: string) {
      return {
        provider: 'cancelling',
        providerChargeId,
        status: 'CANCELED' as const,
        amount: { amountCents: 12_50, currency: 'BRL' },
        method: 'PIX' as const,
      };
    }

    it('voids at the provider and PERSISTS the canceled snapshot', async () => {
      // Both halves matter. The provider call is what stops the buyer paying
      // it; the persisted row is what stops the HOST offering it again.
      const cancel = vi.fn((id: string) => Promise.resolve(voided(id)));
      const world = setupCancellingWorld(cancel);
      world.credentials.set(TENANT, 'cancelling', STUB_CREDS);
      // Raise first: a charge you can void is always one you raised, and the
      // row it stored is the thing the void has to move off PENDING.
      const raised = await world.gateway.charge(TENANT, pixInput('order-void'), {
        provider: 'cancelling',
      });
      expect(raised.snapshot.status).toBe('PENDING');

      const snapshot = await world.gateway.cancelCharge(
        TENANT,
        'cancelling',
        raised.snapshot.providerChargeId,
      );

      expect(cancel).toHaveBeenCalledWith(raised.snapshot.providerChargeId, STUB_CREDS);
      expect(snapshot.status).toBe('CANCELED');
      expect(world.charges.all()).toHaveLength(1);
      expect(world.charges.all()[0]?.snapshot.status).toBe('CANCELED');
    });

    it('refuses on a provider that cannot void, rather than reporting success', async () => {
      // The gap the ticket names: PagBank and InfinitePay have no cancel. A
      // silent no-op here is the dangerous answer — the caller would believe a
      // still-payable charge had been voided and stop guarding it.
      const world = setupGatewayWorld();

      await expect(world.gateway.cancelCharge(TENANT, 'stone', 'CH_1')).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });

    it('refuses to void on a provider that is no longer connected', async () => {
      // Same reasoning as the vault-removal case: a provider we cannot
      // authenticate against still holds a payable charge.
      const cancel = vi.fn((id: string) => Promise.resolve(voided(id)));
      const world = setupCancellingWorld(cancel);

      await expect(
        world.gateway.cancelCharge(TENANT, 'cancelling', 'CH_9'),
      ).rejects.toBeInstanceOf(CredentialsError);
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('applies charge updates, notifies the host, and marks processed', async () => {
      const world = setupGatewayWorld();
      await world.gateway.charge(TENANT, pixInput('order-1'));
      const events = await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
      expect(events).toHaveLength(1);
      expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
      expect(world.seenEvents.map((e) => e.eventId)).toEqual(['evt-1']);
      expect(Object.values(world.webhooks.statuses())).toEqual(['PROCESSED']);
    });

    it('collapses duplicate deliveries to a no-op', async () => {
      const world = setupGatewayWorld();
      await world.gateway.charge(TENANT, pixInput('order-1'));
      await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
      const again = await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
      expect(again).toEqual([]);
      expect(world.seenEvents).toHaveLength(1);
    });

    it('retries a redelivery whose earlier attempt FAILED mid-handler', async () => {
      // A transient failure while the host applies the event (a DB blip while
      // marking the order paid) must not suppress the provider's redelivery —
      // that redelivery is the only automatic recovery there is, and
      // swallowing it would strand a genuinely paid charge.
      const attempts: string[] = [];
      const world = setupGatewayWorld(async (event) => {
        attempts.push(event.eventId);
        if (attempts.length === 1) throw new Error('order confirmation blew up');
      });
      await world.gateway.charge(TENANT, pixInput('order-1'));

      await expect(world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'))).rejects.toThrow(
        'order confirmation blew up',
      );
      expect(Object.values(world.webhooks.statuses())).toEqual(['FAILED']);

      // The SAME event id, redelivered — applied this time, not skipped.
      const retried = await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
      expect(retried).toHaveLength(1);
      expect(attempts).toEqual(['evt-1', 'evt-1']);
      expect(Object.values(world.webhooks.statuses())).toEqual(['PROCESSED']);
    });

    it('ignores stale status regressions (late PENDING after PAID)', async () => {
      const world = setupGatewayWorld();
      await world.gateway.charge(TENANT, pixInput('order-1'));
      await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
      await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-2', 'PENDING'));
      expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
    });

    it('never lets a contradictory terminal state overwrite PAID', async () => {
      const world = setupGatewayWorld();
      await world.gateway.charge(TENANT, pixInput('order-1'));
      await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
      await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-2', 'DECLINED'));
      expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
    });

    it("never applies a webhook update to another merchant's charge", async () => {
      const world = setupGatewayWorld();
      world.credentials.set(OTHER_TENANT, 'stone', STUB_CREDS);
      await world.gateway.charge(TENANT, pixInput('order-1'));
      // tenant-2 presents a (verified) delivery naming tenant-1's charge id:
      // the upsert is ownership-scoped, so tenant-1's charge is untouched.
      const events = await world.gateway.handleWebhook(OTHER_TENANT, stoneDelivery('evt-x', 'PAID'));
      expect(events).toHaveLength(1);
      expect(world.charges.all()[0]?.snapshot.status).toBe('PENDING');
      expect(world.seenEvents[0]?.charge?.status).toBe('PAID');
    });

    it('fails CLOSED on live credentials without a webhook secret', async () => {
      const world = setupGatewayWorld();
      world.credentials.set(TENANT, 'stone', { environment: 'PRODUCTION', fields: {} });
      await expect(
        world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID')),
      ).rejects.toThrow(WebhookVerificationError);
    });

    it('rejects deliveries that fail adapter verification', async () => {
      const world = setupGatewayWorld();
      world.credentials.set(TENANT, 'stone', { ...STUB_CREDS, fields: { webhookSecret: 'shh' } });
      await expect(
        world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID')),
      ).rejects.toThrow(WebhookVerificationError);
    });

    it('marks the inbox row FAILED when the host handler throws', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('host boom'));
      const world = setupGatewayWorld(failingHandler);
      await world.gateway.charge(TENANT, pixInput('order-1'));
      await expect(
        world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID')),
      ).rejects.toThrow('host boom');
      expect(Object.values(world.webhooks.statuses())).toEqual(['FAILED']);
    });
  });

  it('card charges settle immediately in stub mode (and can decline)', async () => {
    const world = setupGatewayWorld();
    const ok = await world.gateway.charge(TENANT, cardInput('order-2', 'tok_ok'));
    expect(ok.snapshot.status).toBe('PAID');
    const declined = await world.gateway.charge(TENANT, cardInput('order-3', 'tok-declined'));
    expect(declined.snapshot.status).toBe('DECLINED');
    expect(declined.snapshot.declineReason).toBe('CARD_DECLINED');
  });

  describe('clientConfig — methods by capability (FUT-698)', () => {
    it('stamps the adapter-declared methods onto the client config', async () => {
      // From the CAPABILITY table, the same source refund gating reads — a
      // second per-adapter copy inside clientConfig would be the one to drift,
      // in the direction of a checkout offering a method the walk refuses.
      const world = setupGatewayWorld();
      const config = await world.gateway.clientConfig(TENANT);
      expect(config?.methods).toEqual(['PIX', 'CARD', 'BOLETO']);
    });

    it('stamps methods onto every entry of the chain config', async () => {
      const world = setupGatewayWorld();
      world.credentials.set(TENANT, 'infinitepay', STUB_CREDS);
      const chain = await world.gateway.clientConfigChain(TENANT);
      expect(chain.map((entry) => [entry.provider, entry.methods])).toEqual([
        ['stone', ['PIX', 'CARD', 'BOLETO']],
        ['infinitepay', ['PIX', 'CARD']],
      ]);
    });
  });
});
