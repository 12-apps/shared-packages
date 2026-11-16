import { describe, expect, it } from 'vitest';

import {
  infinitepayWireSchema,
  itauWireSchema,
  pagbankChargeWireSchema,
  pagbankLegacyWireSchema,
  pagbankOrderWireSchema,
  stoneWireSchema,
  stripeWireSchema,
  WEBHOOK_WIRE_PROVIDERS,
  webhookWireSchema,
} from '../webhook-wire';

// zod 4 treats a `z.unknown()` key as required, so a sample states every declared key (null = not sent in the doc example).
const filled = (schema: { shape: Record<string, unknown> }, sample: Record<string, unknown>): Record<string, unknown> => ({
  ...Object.fromEntries(Object.keys(schema.shape).map((key) => [key, null])),
  ...sample,
});

const order = filled(pagbankOrderWireSchema, {
  id: 'ORDE_1',
  reference_id: 'ref',
  created_at: '2026-01-01T00:00:00Z',
  customer: { name: 'A' },
  items: [],
  charges: [filled(pagbankChargeWireSchema, { id: 'CHAR_1', status: 'PAID', amount: { value: 100 }, links: [] })],
  notification_urls: ['https://x'],
});
const samples: Record<string, unknown> = {
  pagbankOrder: order,
  pagbankLegacy: { notificationCode: 'AB-1', notificationType: 'transaction' },
  stone: filled(stoneWireSchema, { id: 'hook_1', type: 'charge.paid', data: { id: 'ch_1' } }),
  stripe: filled(stripeWireSchema, { id: 'evt_1', type: 'x', data: { object: { id: 'pi_1' }, previous_attributes: null } }),
  infinitepay: filled(infinitepayWireSchema, { invoice_slug: 's', amount: 100, order_nsu: 'o' }),
  itau: { pix: [filled(itauWireSchema.shape.pix.element, { endToEndId: 'E1', txid: 't', valor: '1.00' })] },
};

describe('webhook wire schemas', () => {
  it.each([
    ['pagbankOrder', pagbankOrderWireSchema],
    ['pagbankLegacy', pagbankLegacyWireSchema],
    ['stone', stoneWireSchema],
    ['stripe', stripeWireSchema],
    ['infinitepay', infinitepayWireSchema],
    ['itau', itauWireSchema],
  ])('parses the documented %s sample', (name, schema) => {
    expect(schema.safeParse(samples[name]).success).toBe(true);
  });

  it('keeps an unknown top-level key detectable: it is not a declared shape key', () => {
    expect(Object.keys(pagbankOrderWireSchema.shape)).not.toContain('surprise');
    expect(Object.keys(stoneWireSchema.shape)).not.toContain('surprise');
    expect(pagbankOrderWireSchema.strict().safeParse({ ...order, surprise: 1 }).success).toBe(false);
  });

  it('keeps an unknown nested key detectable', () => {
    expect(Object.keys(pagbankChargeWireSchema.shape)).not.toContain('surprise');
    const charge = { ...(order.charges as object[])[0], surprise: 1 };
    expect(pagbankChargeWireSchema.strict().safeParse(charge).success).toBe(false);
    const entry = itauWireSchema.shape.pix.element;
    expect(Object.keys(entry.shape)).not.toContain('surprise');
    expect(entry.strict().safeParse({ ...(samples.itau as { pix: object[] }).pix[0], surprise: 1 }).success).toBe(false);
    expect(Object.keys(stripeWireSchema.shape.data.shape)).toEqual(['object', 'previous_attributes']);
  });

  it('picks the legacy schema for a notificationCode payload and Order for an object', () => {
    expect(webhookWireSchema('pagbank', samples.pagbankLegacy)).toBe(pagbankLegacyWireSchema);
    expect(webhookWireSchema('pagbank', order)).toBe(pagbankOrderWireSchema);
  });

  it('resolves every declared provider key and nothing else', () => {
    for (const key of WEBHOOK_WIRE_PROVIDERS) expect(webhookWireSchema(key, {})).toBeDefined();
    expect(webhookWireSchema('ifood', {})).toBeUndefined();
    expect(webhookWireSchema('nope', {})).toBeUndefined();
  });
});
