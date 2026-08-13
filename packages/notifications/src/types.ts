/**
 * Core types of the channel-agnostic notification system (12-15).
 *
 * Three decoupled layers, each open for extension without touching the others:
 *   - GENERATORS map a typed domain event to agnostic content (title/body/…).
 *   - The CHANNEL ROUTER always writes the notification-centre inbox record,
 *     then fans out one delivery per enabled channel.
 *   - TRANSPORTS format the agnostic content for one channel and send it.
 *
 * Nothing here knows about a concrete channel's wire format — that lives
 * entirely inside each transport adapter — and nothing here knows about a
 * concrete DOMAIN either: the event `type` set, the preference categories and
 * the channel list are all host config (see {@link NotificationTaxonomy}).
 */

/** Transport channels a notification can fan out to (DB CHECK mirrors this). */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'WEB_PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * The DEFAULT preference categories — the granularity at which a user chooses
 * channels. Every notification `type` belongs to exactly one category via its
 * generator.
 *
 * A host may replace the set entirely (`categories` on the server config): it
 * is product vocabulary, not machinery. These four are the future-pay set, and
 * the packaged migration deliberately puts **no CHECK** on
 * `notifications.category` — a closed set in the schema would be wrong for
 * every host but the first. Unlike `channel` and `status`, which ARE the
 * library's own closed sets and do carry one.
 */
export const NOTIFICATION_CATEGORIES = ['orders', 'payments', 'stock', 'system'] as const;
export type NotificationCategory = string;

/**
 * Per-channel delivery lifecycle (DB CHECK mirrors this).
 *
 * `SENDING` is the CLAIM: exactly one dispatcher moves a row out of `QUEUED`,
 * so two dispatchers can never both send the same delivery. A row left
 * `SENDING` is a dispatcher that died mid-send, and the sweep reclaims it once
 * it is older than the cutoff.
 *
 * `DEAD` is terminal: the attempt ceiling was reached (or the recipient no
 * longer exists), and no sweep will pick the row up again. Without it a
 * permanently invalid destination is a billed provider call on every sweep,
 * forever, and the sweep's working set only grows.
 */
export type DeliveryStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD';

/**
 * Channel-agnostic content a generator produces. This is what the inbox stores
 * verbatim and what every transport's formatter receives — no channel may leak
 * its wire format into it.
 */
export interface NotificationContent {
  title: string;
  body: string;
  /** In-app deep link (a same-origin path such as `/orders/123`). */
  link?: string;
  /** Structured extras for consumers that want more than text. */
  data?: Record<string, unknown>;
}

/** Who receives a notification. `clientId` scopes it to a tenant when set. */
export interface NotificationRecipient {
  userId: string;
  clientId?: string;
}

/**
 * A typed domain event handed to `notify`. `type` selects the registered
 * generator; `payload` is that generator's typed input. Callers never touch
 * channels, formatting, or preferences.
 */
export interface NotificationEvent<TPayload = unknown> {
  type: string;
  recipient: NotificationRecipient;
  payload: TPayload;
}

/**
 * Maps one domain event type to agnostic content. Registered through the
 * server config (or `registerGenerator` for a late arrival); adding a
 * generator never touches existing generators, the router, or any transport
 * (open/closed).
 */
export interface NotificationGenerator<TPayload = unknown> {
  /** The event key, dot-namespaced ("order.paid"). One generator per type. */
  type: string;
  /** The preference category the router gates this type's fan-out on. */
  category: NotificationCategory;
  generate: (payload: TPayload) => NotificationContent;
}

/**
 * The recipient as a transport sees them: resolved destinations only. Built by
 * the router from the host's contact directory + the push subscriptions this
 * package owns; transports use it to answer
 * {@link NotificationTransport.supports}.
 */
export interface TransportRecipient {
  userId: string;
  email: string | null;
  /** Phone as the host stores it (transports normalize per provider rules). */
  phone: string | null;
  /** How many active browser push subscriptions the user holds. */
  pushSubscriptionCount: number;
}

/**
 * One pluggable channel adapter: a FORMATTER (agnostic content → channel
 * message) plus a SENDER. Adding a channel = registering one of these; the
 * router dispatches through the registry and needs no change.
 *
 * `send` resolves on success and THROWS on failure — the router records the
 * error on the delivery row and isolates it from other channels. Sends must be
 * retry-safe: the router may re-dispatch a QUEUED/FAILED delivery.
 */
export interface NotificationTransport<TMessage = unknown> {
  channel: NotificationChannel;
  /**
   * Whether this recipient is addressable on this channel right now — the
   * destination exists (e-mail / phone / push subscription) AND the provider
   * is configured. `false` simply skips the channel (no delivery row).
   */
  supports(recipient: TransportRecipient): boolean;
  /** Transform the agnostic content into this channel's message shape. */
  format(content: NotificationContent): TMessage;
  /** Deliver the formatted message to the recipient. Throws on failure. */
  send(message: TMessage, recipient: TransportRecipient): Promise<void>;
}

/**
 * The host's product vocabulary. Everything below the surface (routing,
 * delivery rows, retries, the wire) is identical for every host; WHICH
 * categories exist and how they are labelled is not.
 */
export interface NotificationTaxonomy {
  /** The preference categories, in the order the settings screen lists them. */
  categories: readonly NotificationCategory[];
}

/** The taxonomy in force, defaulted to the four future-pay categories. */
export function taxonomyOf(config: {
  categories?: readonly NotificationCategory[];
}): NotificationTaxonomy {
  const categories = config.categories ?? NOTIFICATION_CATEGORIES;
  if (categories.length === 0) {
    throw new Error('@12-apps/notifications: `categories` must not be empty.');
  }
  return { categories: [...categories] };
}

/** The host's logger. Defaults to the console (the @12-apps/jobs precedent). */
export interface NotificationLogger {
  info(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}
