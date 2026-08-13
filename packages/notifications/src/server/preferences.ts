import {
  DEFAULT_CHANNEL_ROW,
  enabledChannelsOf,
  mergeChoices,
  mergeStoredRow,
  type ChannelMatrix,
  type ChannelRow,
} from '../preferences-core';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationTaxonomy,
} from '../types';

import type { NotificationsDbProvider } from './db';

/**
 * Per-user channel preferences: which transport channels may carry each
 * notification category to a user. The inbox is NOT gated here — it is always
 * on.
 *
 * The POLICY (defaults, coercion, merge) lives in `../preferences-core.ts`;
 * this is the storage over it, and the split is what lets the react half render
 * the same defaults before the first read lands.
 */

export interface NotificationPreferenceStore {
  /** The user's full matrix, defaults merged in. */
  get(userId: string): Promise<ChannelMatrix>;
  /** Persist explicit choices for any subset of categories/toggles. */
  save(
    userId: string,
    input: Partial<Record<NotificationCategory, Partial<ChannelRow>>>,
  ): Promise<void>;
  /** The channels enabled for one (user, category) — the router's gate. */
  enabledChannels(
    userId: string,
    category: NotificationCategory,
  ): Promise<NotificationChannel[]>;
}

export function createPreferenceStore(
  db: NotificationsDbProvider,
  taxonomy: NotificationTaxonomy,
  channelDefaults: Partial<ChannelRow> = {},
): NotificationPreferenceStore {
  const defaultRow: ChannelRow = { ...DEFAULT_CHANNEL_ROW, ...channelDefaults };
  const known = new Set(taxonomy.categories);

  return {
    async get(userId) {
      const client = await db();
      const rows = await client.notificationPreference.findMany({ where: { userId } });
      const stored = new Map(rows.map((row) => [row.category, row.channels]));
      return Object.fromEntries(
        taxonomy.categories.map((category) => [
          category,
          // A category with no row, or a row missing a channel key, falls back
          // to the defaults — so a NEW channel ships without a data migration.
          mergeStoredRow(stored.get(category), defaultRow),
        ]),
      ) as ChannelMatrix;
    },

    /**
     * Only the categories present on `input` are written; within a category,
     * the toggles are merged over the user's CURRENT effective row (their
     * stored choices, or the defaults when none) — so a single-toggle save
     * (how the settings UI writes) never resets the category's other channels
     * back to their defaults.
     *
     * A category outside the taxonomy is IGNORED rather than stored: the DB
     * CHECK would reject it anyway, and a 500 from a stale client's extra key
     * would fail the whole save including the toggle the user did flip.
     */
    async save(userId, input) {
      const client = await db();
      for (const [category, choices] of Object.entries(input)) {
        if (!choices || !known.has(category)) continue;
        const existing = await client.notificationPreference.findUnique({
          where: { userId_category: { userId, category } },
        });
        const current = existing ? mergeStoredRow(existing.channels, defaultRow) : defaultRow;
        const channels = mergeChoices(current, choices);
        await client.notificationPreference.upsert({
          where: { userId_category: { userId, category } },
          create: { userId, category, channels },
          update: { channels },
        });
      }
    },

    async enabledChannels(userId, category) {
      const client = await db();
      const row = await client.notificationPreference.findUnique({
        where: { userId_category: { userId, category } },
      });
      return enabledChannelsOf(
        row ? mergeStoredRow(row.channels, defaultRow) : defaultRow,
      );
    },
  };
}
