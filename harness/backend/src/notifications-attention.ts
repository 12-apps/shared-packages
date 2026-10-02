import type { NotificationGenerator } from '@12-apps/notifications';
import { ATTENTION_DATA_KEY } from '@12-apps/notifications/attention';

/**
 * An ATTENTION push: `data.attention` is the item's severity, so each device's
 * own level (`push_subscriptions.attention_push`) decides whether it is sent
 * there. A notification of its own, so the harness proves the filter end to end
 * over real SQL without changing what any other type reaches.
 */
export const MESA_WAITING_GENERATOR = {
  type: 'mesa.waiting',
  category: 'orders',
  generate: (payload: { mesa: string; severity: string }) => ({
    title: 'Mesa esperando',
    body: `Mesa ${payload.mesa} chamou.`,
    link: '/tables',
    data: { [ATTENTION_DATA_KEY]: payload.severity },
  }),
} as NotificationGenerator<never>;
