import { describe, expect, it, vi } from 'vitest';

import { TENANT, pixInput } from './fixtures';
import { raisedPix, store } from './manual-charge-world';

/**
 * The paths that reach a Pix-manual charge WITHOUT a staff tap: a void (the
 * buyer's release, a superseded attempt), a walk recovering a charge whose row
 * was lost, a pinned automatic-only charge, and a poll after the store cleared
 * its settings. Each used to treat the provider like one that answers for its
 * own charges.
 */

describe('cancelCharge on a manual charge', () => {
  it('voids a charge nobody confirmed', async () => {
    const world = await store();
    const id = await raisedPix(world);

    const voided = await world.gateway.cancelCharge(TENANT, 'pixmanual', id);

    expect(voided.status).toBe('CANCELED');
    expect((await world.charges.findByProviderChargeId('pixmanual', id))?.snapshot.status).toBe('CANCELED');
  });

  it('answers PAID and leaves a confirmed charge PAID — a void never undoes the store', async () => {
    const world = await store();
    const id = await raisedPix(world);
    await world.gateway.confirmManualCharge(TENANT, 'pixmanual', id);

    const voided = await world.gateway.cancelCharge(TENANT, 'pixmanual', id);

    expect(voided.status).toBe('PAID');
    expect((await world.charges.findByProviderChargeId('pixmanual', id))?.snapshot.status).toBe('PAID');
  });

  it('lets exactly one of a concurrent void and confirm win', async () => {
    const world = await store();
    const id = await raisedPix(world);

    const [voided, confirmed] = await Promise.allSettled([
      world.gateway.cancelCharge(TENANT, 'pixmanual', id),
      world.gateway.confirmManualCharge(TENANT, 'pixmanual', id),
    ]);

    const final = (await world.charges.findByProviderChargeId('pixmanual', id))?.snapshot.status;
    expect(voided.status).toBe('fulfilled');
    expect(final).toBe(confirmed.status === 'fulfilled' ? 'PAID' : 'CANCELED');
    expect(voided.status === 'fulfilled' && voided.value.status).toBe(final);
  });
});

describe('a walk recovering a manual charge whose row was lost', () => {
  it('rebuilds the same code from the adapter instead of reading an empty one back', async () => {
    const world = await store();
    const create = world.charges.create.bind(world.charges);
    world.charges.create = vi.fn(create).mockRejectedValueOnce(new Error('database unavailable'));
    const input = { ...pixInput('order-9'), idempotencyKey: 'order-9' };
    await expect(world.gateway.charge(TENANT, input)).rejects.toThrow();

    const recovered = await world.gateway.charge(TENANT, input);

    expect(recovered.snapshot.status).toBe('PENDING');
    expect(recovered.snapshot.amount).toEqual(pixInput('x').amount);
    expect(recovered.snapshot.pix?.qrText).toMatch(/^000201/);
  });
});

describe('a pinned automatic-only charge', () => {
  it('refuses Pix manual even when the caller names it', async () => {
    const world = await store(['pixmanual', 'itau']);

    await expect(
      world.gateway.charge(TENANT, pixInput('market-4'), { provider: 'pixmanual', confirmation: 'AUTOMATIC' }),
    ).rejects.toThrow(/No payment provider/);
  });
});

describe('a poll after the store cleared its settings', () => {
  it('still answers the stored charge, without needing the credentials', async () => {
    const world = await store();
    const id = await raisedPix(world);
    vi.spyOn(world.credentials, 'getCredentials').mockResolvedValue(null);

    expect((await world.gateway.refreshCharge(TENANT, 'pixmanual', id)).status).toBe('PENDING');
  });
});
