import { describe, expect, it } from 'vitest';

import { UnknownNotificationTypeError } from '../errors';
import { createGeneratorRegistry } from '../generators';
import { DEFAULT_NOTIFICATION_MESSAGES, messagesOf } from '../messages';
import { normalizePhoneE164 } from '../phone';
import { NOTIFICATION_CATEGORIES, taxonomyOf } from '../types';
import { inboxWire, type NotificationRow } from '../wire';

/** The framework-free core: registry, taxonomy, copy table, phones, the wire. */

describe('the generator registry', () => {
  const generator = {
    type: 'order.paid',
    category: 'orders',
    generate: (payload: { code: string }) => ({
      title: 'Pagamento confirmado',
      body: `Pedido ${payload.code} pago.`,
    }),
  };

  it('resolves a generator registered through the constructor', () => {
    const registry = createGeneratorRegistry([generator as never]);
    expect(registry.has('order.paid')).toBe(true);
    expect(registry.resolve('order.paid').category).toBe('orders');
  });

  it('throws UnknownNotificationTypeError for an unregistered type', () => {
    const registry = createGeneratorRegistry();
    expect(() => registry.resolve('nope.event')).toThrow(UnknownNotificationTypeError);
    expect(() => registry.resolve('nope.event')).toThrow(/nope\.event/);
  });

  it('replaces on re-registration, so a hot reload is idempotent', () => {
    const registry = createGeneratorRegistry([generator as never]);
    registry.register({ ...generator, category: 'system' } as never);
    expect(registry.types()).toEqual(['order.paid']);
    expect(registry.resolve('order.paid').category).toBe('system');
  });

  it('is per-instance, so two mounts do not share a set', () => {
    // The whole reason this is not a module-level Map: future-pay's was, which
    // made "which types exist" a property of the module graph.
    const a = createGeneratorRegistry([generator as never]);
    const b = createGeneratorRegistry();
    expect(a.has('order.paid')).toBe(true);
    expect(b.has('order.paid')).toBe(false);
  });
});

describe('the taxonomy', () => {
  it('defaults to the four product categories', () => {
    expect(taxonomyOf({}).categories).toEqual([...NOTIFICATION_CATEGORIES]);
  });

  it('takes the host set verbatim', () => {
    expect(taxonomyOf({ categories: ['invoices'] }).categories).toEqual(['invoices']);
  });

  it('refuses an empty set rather than rendering a preferences screen of nothing', () => {
    expect(() => taxonomyOf({ categories: [] })).toThrow(/must not be empty/);
  });
});

describe('the copy table', () => {
  it('is pt-BR product copy by default', () => {
    expect(DEFAULT_NOTIFICATION_MESSAGES.panelTitle).toBe('Notificações');
    expect(DEFAULT_NOTIFICATION_MESSAGES.emptyBody).toBe(
      'Você está em dia — novidades aparecem aqui.',
    );
    expect(DEFAULT_NOTIFICATION_MESSAGES.openBellWithUnread(3)).toBe(
      'Abrir notificações (3 não lidas)',
    );
    expect(DEFAULT_NOTIFICATION_MESSAGES.daysAgo(1)).toBe('há 1 dia');
    expect(DEFAULT_NOTIFICATION_MESSAGES.daysAgo(3)).toBe('há 3 dias');
  });

  it('merges the nested records per KEY, not per record', () => {
    // A host relabelling one channel must not erase the other three.
    const messages = messagesOf({ messages: { channelLabels: { SMS: 'Texto' } } });
    expect(messages.channelLabels.SMS).toBe('Texto');
    expect(messages.channelLabels.EMAIL).toBe('E-mail');
    expect(messages.categoryLabels.orders?.title).toBe('Pedidos');
  });

  it('lets a host replace a top-level sentence', () => {
    expect(messagesOf({ messages: { panelTitle: 'Alerts' } }).panelTitle).toBe('Alerts');
  });
});

describe('phone normalization', () => {
  // The country is the CALLER's, always — there is no default to fall back on,
  // which is the whole point (see `../phone.ts`).
  const BR = { defaultCountryCode: '55' };
  const US = { defaultCountryCode: '1' };

  it('trusts an explicit international prefix', () => {
    expect(normalizePhoneE164('+55 31 99999-8888', BR)).toBe('+5531999998888');
    expect(normalizePhoneE164('+1 415 555 2671', BR)).toBe('+14155552671');
  });

  it('assumes the DECLARED country for a bare local number', () => {
    expect(normalizePhoneE164('31999998888', BR)).toBe('+5531999998888');
    expect(normalizePhoneE164('(31) 3333-4444', BR)).toBe('+553133334444');
  });

  it('takes the host country code when it is not Brazil', () => {
    expect(normalizePhoneE164('4155552671', US)).toBe('+14155552671');
  });

  it('never sends a local number to the country the package used to assume', () => {
    // The hazard the required knob removes: with `55` as a DEFAULT, a US adopter
    // that never set it turned `4155552671` into `+554155552671` — a plausible
    // Brazilian mobile, and a stranger reading a customer's order. There is no
    // call site left that can omit the country, so that string is now reachable
    // only by having asked for Brazil.
    expect(normalizePhoneE164('4155552671', US)).toBe('+14155552671');
    expect(normalizePhoneE164('4155552671', BR)).toBe('+554155552671');
  });

  it('keeps a bare number that already carries the country code', () => {
    expect(normalizePhoneE164('5531999998888', BR)).toBe('+5531999998888');
  });

  it('refuses what it cannot infer, which makes the channel unavailable', () => {
    for (const raw of [null, undefined, '', '   ', '123', '+123', 'não tenho']) {
      expect(normalizePhoneE164(raw, BR)).toBeNull();
    }
  });

  it('refuses an over-long international number (E.164 caps at 15 digits)', () => {
    expect(normalizePhoneE164('+1234567890123456', BR)).toBeNull();
  });
});

describe('the inbox wire shape', () => {
  const row: NotificationRow = {
    id: 'n1',
    userId: 'u1',
    clientId: 'c1',
    type: 'order.paid',
    category: 'orders',
    title: 'Pagamento confirmado',
    body: 'Pedido A1 pago.',
    link: '/orders/A1',
    data: { code: 'A1' },
    readAt: new Date('2026-08-13T10:00:00.000Z'),
    deletedAt: null,
    createdAt: new Date('2026-08-13T09:00:00.000Z'),
  };

  it('serializes dates as ISO strings and keeps the payload', () => {
    expect(inboxWire(row)).toEqual({
      id: 'n1',
      type: 'order.paid',
      category: 'orders',
      title: 'Pagamento confirmado',
      body: 'Pedido A1 pago.',
      link: '/orders/A1',
      data: { code: 'A1' },
      readAt: '2026-08-13T10:00:00.000Z',
      createdAt: '2026-08-13T09:00:00.000Z',
    });
  });

  it('reads an unread row as readAt null and a null payload as {}', () => {
    const wire = inboxWire({ ...row, readAt: null, data: null });
    expect(wire.readAt).toBeNull();
    expect(wire.data).toEqual({});
  });

  it('does NOT leak userId or clientId onto the wire', () => {
    // The inbox is self-scoped, so the owner is never a field the client reads —
    // and `clientId` is tenant routing the browser has no business knowing.
    const wire = inboxWire(row) as unknown as Record<string, unknown>;
    expect(wire.userId).toBeUndefined();
    expect(wire.clientId).toBeUndefined();
  });
});
