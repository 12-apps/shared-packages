import {
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from './types';

/**
 * The preference POLICY, with no storage in it (12-15): which channels a
 * category defaults to, how a stored JSON row is coerced onto the closed
 * channel set, and how a partial save merges. `./server`'s store is the only
 * thing that touches a database, so every rule here is unit-testable without
 * one — and the react half can render the same defaults before the first read
 * lands.
 *
 * Storage stores only EXPLICIT choices (one row per (user, category)); a
 * missing row — or a missing channel key inside a row — falls back to
 * {@link DEFAULT_CHANNEL_ROW}. Defaults: the free, low-friction channels
 * (e-mail + web push) on; the paid per-message channels (SMS + WhatsApp) off
 * until the user opts in. A host that disagrees passes `channelDefaults`.
 */

/** One category's channel toggles. */
export type ChannelRow = Record<NotificationChannel, boolean>;

/** A user's full category × channel matrix. */
export type ChannelMatrix = Record<NotificationCategory, ChannelRow>;

/** The policy applied when a user never touched a category's toggles. */
export const DEFAULT_CHANNEL_ROW: ChannelRow = {
  EMAIL: true,
  SMS: false,
  WHATSAPP: false,
  WEB_PUSH: true,
};

/** The default matrix for one taxonomy (what the settings UI starts from). */
export function defaultChannelMatrix(
  categories: readonly NotificationCategory[],
  channelDefaults: Partial<ChannelRow> = {},
): ChannelMatrix {
  const row = { ...DEFAULT_CHANNEL_ROW, ...channelDefaults };
  return Object.fromEntries(
    categories.map((category) => [category, { ...row }]),
  ) as ChannelMatrix;
}

/**
 * Coerce a stored JSON `channels` map onto the closed channel set, filling the
 * gaps from `base`. A stored row that predates a channel keeps that channel's
 * default rather than reading as "off", which is what lets a new transport ship
 * without a data migration.
 */
export function mergeStoredRow(stored: unknown, base: ChannelRow): ChannelRow {
  const row = { ...base };
  if (stored && typeof stored === 'object') {
    const record = stored as Record<string, unknown>;
    for (const channel of NOTIFICATION_CHANNELS) {
      const value = record[channel];
      if (typeof value === 'boolean') row[channel] = value;
    }
  }
  return row;
}

/** The channels enabled by one effective row — the router's gate. */
export function enabledChannelsOf(row: ChannelRow): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => row[channel]);
}

/**
 * What a PUT writes for one category: the caller's toggles merged over the
 * user's CURRENT effective row. A single-toggle save (how the settings UI
 * writes) must never reset the category's other channels back to their
 * defaults, which is exactly what a whole-row write would do.
 */
export function mergeChoices(
  current: ChannelRow,
  choices: Partial<ChannelRow>,
): ChannelRow {
  return { ...current, ...choices };
}
