import { createGeneratorRegistry, type NotificationGeneratorRegistry } from '../generators';
import { messagesOf, type NotificationMessages } from '../messages';
import type { ChannelRow } from '../preferences-core';
import {
  taxonomyOf,
  type NotificationCategory,
  type NotificationGenerator,
  type NotificationLogger,
} from '../types';

import {
  createNotifyByPermission,
  type NotificationAudienceDirectory,
  type NotifyByPermission,
} from './by-permission';
import type { NotificationsRoute } from './context';
import type { NotificationContactDirectory, NotificationsDbProvider } from './db';
import { DEFAULT_MAX_DELIVERY_ATTEMPTS } from './dispatch';
import { createInboxStore, type NotificationInboxStore } from './inbox';
import { createPreferenceStore, type NotificationPreferenceStore } from './preferences';
import {
  createPushSubscriptionStore,
  type PushSubscriptionStore,
} from './push-subscriptions';
import { notificationRoutes } from './routes';
import {
  createNotificationRouter,
  type NotificationChannelPolicy,
  type NotificationCommittedListener,
  type NotificationDispatchScheduler,
  type NotificationRouter,
} from './router';
import {
  createTransportRegistry,
  type ExtraDrivers,
  type TransportDeclaration,
  type TransportRegistry,
} from './transports/registry';

/**
 * The one thing this package exposes to a BACKEND host (12-15).
 *
 * The pipeline used to be a private workspace package plus six hand-written
 * route files: each one resolving the session, calling a loose helper, and
 * shaping a response, with the transports reading their own credentials out of
 * `process.env` and registering themselves as an import side effect. Only "who
 * is calling, where the rows live, how a channel reaches a person" was ever the
 * host's business; the rest — the routing, the delivery rows, the retries, the
 * request contract, the envelope, the pt-BR copy — is this surface's.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router (the
 * report-builder doctrine). `@12-apps/notifications/hono` adapts them.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication** — the adapter's `resolveActor` hands over a user id.
 *    Every endpoint is self-scoped, so that is the entire authorization seam.
 *  - **Where the four owned tables live** — the structural `db` seam.
 *  - **How to reach a person** — `contacts`, because a package cannot know the
 *    shape of a host's identity table (nor whether its phones are verified).
 *  - **Which vendors carry which channel** — `transports`, one declaration per
 *    channel. An undeclared channel is off; a second vendor is a config entry.
 *  - **Billing** — `channelPolicy`, the plan gate answered per emit.
 *  - **Its authorization engine** — `audience`, for the permission fan-out.
 *  - **Its domain events** — `generators`, registered from the outside.
 */

export interface NotificationsServerConfig {
  /** Prisma-shaped client for the four owned models, through the seam. */
  db: NotificationsDbProvider;
  /** How a transport reaches a person (the host's identity table). */
  contacts: NotificationContactDirectory;
  /** One declaration per channel the host wants on. Default: none, all off. */
  transports?: readonly TransportDeclaration[];
  /** The host's own vendor drivers, per channel. */
  drivers?: ExtraDrivers;
  /** The domain events this mount can emit. */
  generators?: readonly NotificationGenerator<never>[];
  /**
   * Preference categories — the granularity at which a user chooses channels.
   *
   * REQUIRED. This defaulted to one product's four (`orders`, `payments`,
   * `stock`, `system`), which is the host's vocabulary and not this library's:
   * a host that omitted it rendered four rows it never chose, with its own
   * categories absent, and nothing failed — `category` is a free string by
   * design, so there was no layer left to notice.
   */
  categories: readonly NotificationCategory[];
  /** Override which channels a never-touched category defaults to. */
  channelDefaults?: Partial<ChannelRow>;
  /** The tenant plan gate, answered per emit. */
  channelPolicy?: NotificationChannelPolicy;
  /** Hand dispatch to a real queue instead of the in-process detached send. */
  scheduleDispatch?: NotificationDispatchScheduler;
  /**
   * Claims one delivery gets before the sweep gives up on it and writes DEAD.
   * Default 5. There is no "unlimited": a permanently invalid destination would
   * be a billed provider call on every sweep for the life of the row.
   */
  maxDeliveryAttempts?: number;
  /** Told the moment an inbox record commits (a realtime bus, typically). */
  onCommitted?: NotificationCommittedListener;
  /** Told when a mark-read/delete actually changed something. */
  onInboxChanged?: (userId: string) => void;
  /** The host's authorization engine, for `notifyByPermission`. */
  audience?: NotificationAudienceDirectory;
  /** User-facing copy overrides (pt-BR product copy by default). */
  messages?: Partial<NotificationMessages>;
  /** The host's logger. Defaults to the console. */
  logger?: NotificationLogger;
}

export interface ApiNotifications {
  /** The whole generated surface, in mount order. */
  routes: NotificationsRoute[];
  /** The emit front door. */
  notify: NotificationRouter['notify'];
  /** Send every still-QUEUED delivery of one notification. */
  dispatchDeliveries: NotificationRouter['dispatchDeliveries'];
  /** The retry sweep, for a cron/admin trigger. */
  drainPending: NotificationRouter['drainPending'];
  /**
   * "Tell whoever can act on this." Rejects when the host configured no
   * `audience` — loudly, because the alternative is a money alert nobody gets.
   */
  notifyByPermission: NotifyByPermission;
  /** The stores, for host surfaces that read the same tables. */
  inbox: NotificationInboxStore;
  preferences: NotificationPreferenceStore;
  pushSubscriptions: PushSubscriptionStore;
  /** Register a generator after the mount (a lazily-imported domain module). */
  registerGenerator: NotificationGeneratorRegistry['register'];
  /** The declared transports, for diagnostics and availability probes. */
  transports: TransportRegistry;
  /** The copy in force, so a host's own screens can reuse a sentence. */
  messages: NotificationMessages;
}

/** Drop the keys the host left unset, so an absent seam stays absent. */
function present<T extends object>(entries: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Fallback logger — used until the host passes its own. */
const consoleLogger: NotificationLogger = {
  info: (message, ...meta) => console.info(message, ...meta),
  error: (message, ...meta) => console.error(message, ...meta),
};

export function createApiNotifications(config: NotificationsServerConfig): ApiNotifications {
  const messages = messagesOf(config);
  const taxonomy = taxonomyOf(config);
  const logger = config.logger ?? consoleLogger;

  const generators = createGeneratorRegistry(config.generators ?? []);
  const inbox = createInboxStore(config.db);
  const preferences = createPreferenceStore(
    config.db,
    taxonomy,
    config.channelDefaults ?? {},
  );
  const pushSubscriptions = createPushSubscriptionStore(config.db, logger);
  const transports = createTransportRegistry(
    config.transports ?? [],
    pushSubscriptions,
    config.drivers ?? {},
    logger,
  );

  const router = createNotificationRouter({
    db: config.db,
    generators,
    transports,
    preferences,
    pushSubscriptions,
    contacts: config.contacts,
    logger,
    maxAttempts: config.maxDeliveryAttempts ?? DEFAULT_MAX_DELIVERY_ATTEMPTS,
    // `exactOptionalPropertyTypes` is on, so an absent host seam must be an
    // ABSENT key rather than an explicit `undefined`.
    ...present({
      channelPolicy: config.channelPolicy,
      scheduleDispatch: config.scheduleDispatch,
      onCommitted: config.onCommitted,
    }),
  });

  const audience = config.audience;
  const notifyByPermission: NotifyByPermission = audience
    ? createNotifyByPermission({ router, directory: audience, logger })
    : () =>
        Promise.reject(
          new Error(
            'notifyByPermission() needs an `audience` directory — pass the host authorization ' +
              'engine to createApiNotifications({ audience }).',
          ),
        );

  return {
    routes: notificationRoutes({
      inbox,
      preferences,
      pushSubscriptions,
      transports,
      contacts: config.contacts,
      categories: taxonomy.categories,
      messages,
      ...present({ onInboxChanged: config.onInboxChanged }),
    }),
    notify: router.notify,
    dispatchDeliveries: router.dispatchDeliveries,
    drainPending: router.drainPending,
    notifyByPermission,
    inbox,
    preferences,
    pushSubscriptions,
    registerGenerator: generators.register,
    transports,
    messages,
  };
}
