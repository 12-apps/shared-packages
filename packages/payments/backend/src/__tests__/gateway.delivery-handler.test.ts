import { describe, expect, it, vi } from 'vitest';

import type { WebhookEventHandler } from '../core/ports';

import { TENANT, pixInput, setupGatewayWorld, stoneDelivery } from './fixtures';

/**
 * A reaction one delivery adds to the gateway's own (FUT-4864): run after
 * `onWebhookEvent`, for the events of THAT delivery only, inside the ingest —
 * its failure fails the inbox row and the redelivery runs it again. It is what
 * lets a host bind a reaction from its webhook route instead of from where it
 * builds the gateway.
 */
describe('a per-delivery webhook handler', () => {
  it('runs after the gateway handler, for that delivery only', async () => {
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const order: string[] = [];
    const extra = vi.fn<WebhookEventHandler>(async (event) => {
      order.push(`extra:${event.eventId}`);
    });

    await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'), { onWebhookEvent: extra });
    await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-2', 'PAID'));

    expect(extra).toHaveBeenCalledOnce();
    expect(extra.mock.calls[0]?.[2]).toEqual(TENANT);
    expect(world.seenEvents.map((e) => e.eventId)).toEqual(['evt-1', 'evt-2']);
    expect(order).toEqual(['extra:evt-1']);
  });

  it('fails the inbox row when it throws, and the redelivery runs it again', async () => {
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const extra = vi.fn().mockRejectedValueOnce(new Error('refund store down')).mockResolvedValue(undefined);

    await expect(world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'), { onWebhookEvent: extra })).rejects.toThrow(
      'refund store down',
    );
    expect(Object.values(world.webhooks.statuses())).toEqual(['FAILED']);

    await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'), { onWebhookEvent: extra });
    expect(extra).toHaveBeenCalledTimes(2);
    expect(Object.values(world.webhooks.statuses())).toEqual(['PROCESSED']);
  });

  it('does not run when the gateway handler throws: the row fails and the redelivery runs both', async () => {
    const own = vi.fn<WebhookEventHandler>().mockRejectedValueOnce(new Error('orders down')).mockResolvedValue(undefined);
    const world = setupGatewayWorld(own);
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const extra = vi.fn<WebhookEventHandler>(async () => undefined);

    await expect(world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'), { onWebhookEvent: extra })).rejects.toThrow('orders down');
    expect(extra).not.toHaveBeenCalled();
    await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'), { onWebhookEvent: extra });
    expect(extra).toHaveBeenCalledOnce();
  });

  it('is not run by a replay of the row it failed: only the gateway handler is (the documented gap)', async () => {
    const own = vi.fn<WebhookEventHandler>(async () => undefined);
    const world = setupGatewayWorld(own);
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const extra = vi.fn<WebhookEventHandler>().mockRejectedValue(new Error('refund store down'));
    await expect(world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'), { onWebhookEvent: extra })).rejects.toThrow();
    own.mockClear();

    const report = await world.gateway.replayWebhooks({ now: new Date('2099-01-01T00:00:00Z') });

    expect(report.processed).toBe(1);
    expect(own).toHaveBeenCalledOnce();
    expect(extra).toHaveBeenCalledOnce();
    expect(Object.values(world.webhooks.statuses())).toEqual(['PROCESSED']);
  });
});
