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
}

export interface NotificationsApiClient {
  listNotifications(input: {
    cursor?: string | null;
    limit?: number;
    filter?: 'all' | 'unread';
  }): Promise<ListNotificationsResult>;
  unreadCount(): Promise<number>;
  markRead(ids: readonly string[]): Promise<NotificationsResult<{ updated: number }>>;
  markAllRead(): Promise<NotificationsResult<{ updated: number }>>;
  remove(ids: readonly string[]): Promise<NotificationsResult<{ deleted: number }>>;
  getPreferences(): Promise<PreferencesPayload>;
  savePreference(
    category: string,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<NotificationsResult<PreferencesPayload>>;
  getPushRegistration(): Promise<PushRegistrationPayload>;
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
      const { count } = await transport.get<{ count: number }>(
        url('/notifications/unread-count'),
      );
      return count;
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
    getPushRegistration: () =>
      transport.get<PushRegistrationPayload>(url('/push-subscriptions')),
    savePushSubscription: (input) => transport.send(url('/push-subscriptions'), 'POST', input),
    removePushSubscription: (endpoint) =>
      transport.send(url('/push-subscriptions'), 'DELETE', { endpoint }),
  };
}
