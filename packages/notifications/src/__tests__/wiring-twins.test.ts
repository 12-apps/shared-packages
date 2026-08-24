/**
 * The assignability proof for the twins THIS package owns.
 *
 * The RFC opens on "twin shapes are unverified": `@12-apps/payments-backend`
 * restates `@12-apps/jobs`' blueprint field-for-field and nothing compiles the
 * two against each other, so the pinning is a comment and one string-equality
 * test. `@12-apps/wiring` closed that for the jobs twin in its own suite
 * (`jobs-compat.test.ts`). The notification twin — `WireNotificationBlueprint`,
 * declared to be `NotificationGenerator` with `category` widened to `string` —
 * had no such proof anywhere, on the twin owned by the package the contract
 * copied it FROM.
 *
 * That is the asymmetry these cases fix. If either shape moves, this file
 * stops compiling in this repo, rather than a host discovering it when a
 * package's blueprint is rejected by a mount that used to accept it.
 */

import { describe, expect, it } from 'vitest';
import type {
  AnyNotificationBlueprint,
  WireNotificationBlueprint,
  WireNotificationContent,
} from '@12-apps/wiring';

import type { NotificationContent, NotificationGenerator } from '../types';

interface OrderPaid {
  orderId: string;
  totalCents: number;
}

const generator: NotificationGenerator<OrderPaid> = {
  type: 'order.paid',
  category: 'orders',
  generate: (payload) => ({
    title: 'Pedido pago',
    body: `Pedido ${payload.orderId} — ${payload.totalCents}`,
    link: `/orders/${payload.orderId}`,
  }),
};

/**
 * A generator IS a blueprint. This is the direction that matters at runtime:
 * a host feeds package blueprints into `createApiNotifications({ generators })`
 * beside its own, and if this assignment ever failed it would fail at every
 * adoption site at once.
 */
const generatorAsBlueprint: WireNotificationBlueprint<OrderPaid> = generator;

/**
 * And a blueprint is a generator, PROVIDED its suggested category survives the
 * host's taxonomy — which is why `category` is `string` on the wire side and
 * `NotificationCategory` here. `NotificationCategory` is itself `string`
 * today, so the assignment holds in both directions; the day a host's taxonomy
 * becomes a union, this line is what will refuse to compile and force the
 * mapping step the contract already documents ("the host maps or vetoes each
 * blueprint's suggested category at adoption").
 */
const blueprintAsGenerator: NotificationGenerator<OrderPaid> = generatorAsBlueprint;

/** The content twins, in both directions, for the same reason. */
const contentAsWire: WireNotificationContent = generator.generate({
  orderId: 'o1',
  totalCents: 100,
});
const wireAsContent: NotificationContent = { ...contentAsWire, data: { ...contentAsWire.data } };

/** The erased form the shared manifest carries — a heterogeneous list. */
const erased: readonly AnyNotificationBlueprint[] = [
  generator as WireNotificationBlueprint<never>,
];

describe('the notification twins against @12-apps/wiring', () => {
  it('keeps NotificationGenerator and WireNotificationBlueprint mutually assignable', () => {
    expect(generatorAsBlueprint.type).toBe('order.paid');
    expect(blueprintAsGenerator.category).toBe('orders');
  });

  it('renders the same content object through either type', () => {
    expect(contentAsWire).toEqual({
      title: 'Pedido pago',
      body: 'Pedido o1 — 100',
      link: '/orders/o1',
    });
    expect(wireAsContent.title).toBe(contentAsWire.title);
  });

  it('erases into the shared manifest blueprint list', () => {
    expect(erased).toHaveLength(1);
    expect(erased[0]?.type).toBe('order.paid');
  });
});
