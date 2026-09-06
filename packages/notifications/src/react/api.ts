import type { ChannelRow } from '../preferences-core';
import type { NotificationChannel } from '../types';
import type { ListNotificationsResult } from '../wire';

import type { NotificationsResult, NotificationsTransport } from './transport';

/**
 * The wire client, bound to one mount (12-15).
 *
 * Every path this package's screens can call, in one place — which is what
 * makes the api half's route table and the web half's URLs one contract instead
 * of two lists that drift.
 */

/** `GET <mount>/notification-preferences` and the PUT's answer. */
export interface PreferencesPayload {
  preferences: Record<string, ChannelRow>;
  availability: Record<NotificationChannel, boolean>;
  /** The host's taxonomy, so the screen renders it without being told twice. */
  categories: string[];
}

/** `GET <mount>/push-subscriptions`. */
export interface PushRegistrationPayload {
  /** null = web push is not configured on this deployment. */
  vapidPublicKey: string | null;
  count: number;
  /**
   * Whether the endpoint asked about is still registered to the caller. Present
   * only when one was passed — see {@link NotificationsApiClient.getPushRegistration}.
   */
  registered?: boolean;
}

/**
 * What `/notifications/unread-count` answers.
 *
 * `liveSubjects` is how many unread rows are ABOUT each ongoing subject — see
 * `UnreadSummary` on the server half, which owns the reasoning. The surface
 * needs both halves to count one happening thing once.
 */
export interface UnreadCount {
  count: number;
  liveSubjects: Readonly<Record<string, number>>;
}

export interface NotificationsApiClient {
  listNotifications(input: {
    cursor?: string | null;
    limit?: number;
    filter?: 'all' | 'unread';
  }): Promise<ListNotificationsResult>;
  unreadCount(): Promise<UnreadCount>;
  markRead(ids: readonly string[]): Promise<NotificationsResult<{ updated: number }>>;
  markAllRead(): Promise<NotificationsResult<{ updated: number }>>;
  remove(ids: readonly string[]): Promise<NotificationsResult<{ deleted: number }>>;
  getPreferences(): Promise<PreferencesPayload>;
  savePreference(
    category: string,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<NotificationsResult<PreferencesPayload>>;
  /**
   * The deployment's VAPID key and the caller's device count — and, when an
   * `endpoint` is passed, whether the SERVER still has that exact subscription
   * under the caller's id. The browser holding a subscription object is not
   * evidence of that: a re-own or a 404/410 prune drops the row and leaves the
   * browser's object in place.
   */
  getPushRegistration(input?: { endpoint?: string }): Promise<PushRegistrationPayload>;
  savePushSubscription(input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }): Promise<NotificationsResult<{ count: number }>>;
  removePushSubscription(endpoint: string): Promise<NotificationsResult<{ count: number }>>;
}

export function createNotificationsApiClient(
  apiBase: string,
  transport: NotificationsTransport,
): NotificationsApiClient {
  const base = apiBase.replace(/\/$/, '');
  const url = (path: string): string => `${base}${path}`;

  return {
    listNotifications({ cursor, limit, filter }) {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      if (filter) params.set('filter', filter);
      const query = params.toString();
      return transport.get<ListNotificationsResult>(
        url(`/notifications${query ? `?${query}` : ''}`),
      );
    },
    async unreadCount() {
      const body = await transport.get<{
        count: number;
        liveSubjects?: Readonly<Record<string, number>>;
      }>(url('/notifications/unread-count'));
      // Absent, not empty, is what a server from before the breakdown answers —
      // and for the length of a rollout that server is the one a freshly loaded
      // bundle is talking to. Defaulting degrades to the count alone, which is
      // what the badge did before this existed.
      return { count: body.count, liveSubjects: body.liveSubjects ?? {} };
    },
    markRead: (ids) =>
      transport.send(url('/notifications/mark-read'), 'POST', { ids: [...ids] }),
    markAllRead: () => transport.send(url('/notifications/mark-read'), 'POST', { all: true }),
    remove: (ids) => transport.send(url('/notifications/delete'), 'POST', { ids: [...ids] }),
    getPreferences: () => transport.get<PreferencesPayload>(url('/notification-preferences')),
    savePreference: (category, channel, enabled) =>
      transport.send(url('/notification-preferences'), 'PUT', {
        [category]: { [channel]: enabled },
      }),
    getPushRegistration: ({ endpoint } = {}) =>
      transport.get<PushRegistrationPayload>(
        url(
          endpoint
            ? `/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`
            : '/push-subscriptions',
        ),
      ),
    savePushSubscription: (input) => transport.send(url('/push-subscriptions'), 'POST', input),
    removePushSubscription: (endpoint) =>
      transport.send(url('/push-subscriptions'), 'DELETE', { endpoint }),
  };
}
