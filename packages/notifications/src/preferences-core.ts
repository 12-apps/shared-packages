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
 *
 * The consequence, and the rule it implies: a channel ADDED later turns itself
 * ON for a user who had explicitly switched every channel in that category off,
 * because their stored row has no key for it. That is harmless for the four
 * shipped channels — the two that cost money default off — so **a new channel
 * must be added with a `false` default** unless the user's existing consent
 * already covers it. The alternative (reading a missing key as "off") would need
 * a data migration for every existing row on every channel that ever ships.
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

/**
 * What ONE notification type says about its own channels, independent of the
 * user's category preferences: {@link NotificationGenerator.channels} (the hard
 * availability cap) and {@link NotificationGenerator.channelDefaults} (a
 * starting point the user can still move).
 *
 * Structurally what a generator already is, rather than the generator itself,
 * so the policy here stays free of the registry and the router.
 */
export interface TypeChannelRules {
  channels?: readonly NotificationChannel[];
  channelDefaults?: Partial<ChannelRow>;
}

/**
 * The channels a type may EVER use, coerced onto the closed channel set.
 *
 * `undefined` — a generator that never declared a list — means every channel,
 * which is what keeps every generator written before the field working. An
 * EMPTY list means no transport channel at all and is legal: the inbox record
 * is written by the router regardless, and the inbox is not a channel a user
 * opts out of.
 *
 * Filtering through {@link NOTIFICATION_CHANNELS} rather than returning the
 * declaration is deliberate: it drops a value that is not a channel (a typo, a
 * channel removed from the set since) instead of carrying it into an
 * intersection where it would silently match nothing anyway, and it fixes the
 * order so two declarations of the same set compare equal.
 */
export function availableChannelsOf(
  declared: readonly NotificationChannel[] | undefined,
): NotificationChannel[] {
  if (!declared) return [...NOTIFICATION_CHANNELS];
  const offered = new Set<string>(declared);
  return NOTIFICATION_CHANNELS.filter((channel) => offered.has(channel));
}

/**
 * Drop the channels a type does not offer. Applied by the router AFTER every
 * other gate, so no later stage can hand back a channel the type never offered
 * — including the plan gate's own error fallback, which degrades to the free
 * channels and would otherwise restore an e-mail this type had just refused.
 */
export function capToAvailable(
  channels: readonly NotificationChannel[],
  declared: readonly NotificationChannel[] | undefined,
): NotificationChannel[] {
  if (!declared) return [...channels];
  const offered = new Set(availableChannelsOf(declared));
  return channels.filter((channel) => offered.has(channel));
}

/**
 * The channels one (user, category, TYPE) actually enables — the whole policy
 * in one pure function, so the router's gate can be argued about without a
 * database.
 *
 * The order is the meaning:
 *   1. the category's defaults, with the TYPE's defaults over them — a type
 *      moves the starting point;
 *   2. the user's stored row over that — an explicit choice beats any default,
 *      which is what makes step 1 a default rather than a rule;
 *   3. the type's AVAILABILITY over everything — a channel this type does not
 *      offer is gone even when the user's stored row explicitly asked for it,
 *      because it was never on offer for this message.
 *
 * Step 3 overriding a stored `true` is the one place a user's saved choice is
 * discarded, and it is the point of the field: a diner sitting at the mesa who
 * once ticked "e-mail" for `orders` was answering a question about delivery
 * receipts, not about the kitchen three metres away.
 */
export function resolveTypeChannels(input: {
  /** The stored `channels` JSON for this (user, category), if any. */
  stored?: unknown;
  /** The category's effective default row (host defaults already merged). */
  categoryDefaults: ChannelRow;
  /** The type's own declarations. */
  rules?: TypeChannelRules;
}): NotificationChannel[] {
  const { stored, categoryDefaults, rules } = input;
  const base: ChannelRow = { ...categoryDefaults, ...rules?.channelDefaults };
  const row = stored === undefined || stored === null ? base : mergeStoredRow(stored, base);
  return capToAvailable(enabledChannelsOf(row), rules?.channels);
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
