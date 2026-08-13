/**
 * The database seam (12-15) — the exact, narrow slice of a Prisma-shaped
 * client this surface reads and writes on the four models the package owns
 * (`prisma/notifications.prisma`). Structural on purpose, never generated: a
 * real host passes its Prisma client; the harness passes hand-written SQL, and
 * the stores cannot tell.
 *
 * Every argument type below is CLOSED — the union of the shapes this package's
 * own stores actually pass — so a non-Prisma implementation has a finite,
 * documented surface to satisfy instead of "all of Prisma".
 *
 * What is NOT here: the `users` table. future-pay's router read
 * `users.email/phone` directly to answer "can this channel reach them", which
 * is the one thing in the pipeline that belonged to the host all along — a
 * package cannot know the shape of a host's identity table, and a host with
 * phone VERIFICATION wants to answer the question differently. It crosses as
 * {@link NotificationContactDirectory} instead.
 */

import type { DeliveryStatus, NotificationChannel } from '../types';
import type { NotificationRow } from '../wire';

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

export interface NotificationCreateData {
  userId: string;
  clientId: string | null;
  type: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
}

/** The inbox read filter. `deletedAt: null` is on every read, always. */
export interface NotificationWhere {
  userId?: string;
  id?: string | { in: string[] };
  deletedAt: null;
  readAt?: null;
}

export interface NotificationDelegate {
  create(args: { data: NotificationCreateData }): Promise<NotificationRow>;
  findUnique(args: { where: { id: string } }): Promise<NotificationRow | null>;
  findMany(args: {
    where: NotificationWhere;
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }];
    take: number;
    cursor?: { id: string };
    skip?: number;
  }): Promise<NotificationRow[]>;
  count(args: { where: NotificationWhere }): Promise<number>;
  updateMany(args: {
    where: NotificationWhere;
    data: { readAt: Date } | { deletedAt: Date };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// notification_deliveries
// ---------------------------------------------------------------------------

export interface NotificationDeliveryRow {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDeliveryWhere {
  id?: string | { in: string[] };
  notificationId?: string;
  status?: DeliveryStatus;
  OR?: {
    status: DeliveryStatus;
    updatedAt?: { lt: Date };
    createdAt?: { lt: Date };
  }[];
}

export interface NotificationDeliveryDelegate {
  createMany(args: {
    data: { notificationId: string; channel: NotificationChannel }[];
    skipDuplicates: true;
  }): Promise<{ count: number }>;
  findMany(args: { where: NotificationDeliveryWhere }): Promise<NotificationDeliveryRow[]>;
  update(args: {
    where: { id: string };
    data: {
      status: DeliveryStatus;
      sentAt?: Date | null;
      error?: string | null;
    };
  }): Promise<NotificationDeliveryRow>;
  updateMany(args: {
    where: NotificationDeliveryWhere;
    data: { status: DeliveryStatus };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// notification_preferences
// ---------------------------------------------------------------------------

export interface NotificationPreferenceRow {
  id: string;
  userId: string;
  category: string;
  channels: unknown;
}

export interface NotificationPreferenceDelegate {
  findMany(args: { where: { userId: string } }): Promise<NotificationPreferenceRow[]>;
  findUnique(args: {
    where: { userId_category: { userId: string; category: string } };
  }): Promise<NotificationPreferenceRow | null>;
  upsert(args: {
    where: { userId_category: { userId: string; category: string } };
    create: { userId: string; category: string; channels: Record<string, boolean> };
    update: { channels: Record<string, boolean> };
  }): Promise<NotificationPreferenceRow>;
}

// ---------------------------------------------------------------------------
// push_subscriptions
// ---------------------------------------------------------------------------

export interface PushSubscriptionRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface PushSubscriptionDelegate {
  count(args: { where: { userId: string } }): Promise<number>;
  findMany(args: { where: { userId: string } }): Promise<PushSubscriptionRow[]>;
  upsert(args: {
    where: { endpoint: string };
    create: {
      userId: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent: string | null;
    };
    update: {
      userId: string;
      p256dh: string;
      auth: string;
      userAgent: string | null;
    };
  }): Promise<PushSubscriptionRow>;
  delete(args: { where: { id: string } }): Promise<PushSubscriptionRow>;
  deleteMany(args: {
    where: { userId: string; endpoint: string };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** The model delegates — what both a live client and a transaction expose. */
export interface NotificationsDbClient {
  notification: NotificationDelegate;
  notificationDelivery: NotificationDeliveryDelegate;
  notificationPreference: NotificationPreferenceDelegate;
  pushSubscription: PushSubscriptionDelegate;
}

/**
 * The full seam: delegates plus interactive transactions. The inbox record and
 * its delivery rows commit together, so a crash can never leave a notification
 * a user can see with no record of what was meant to carry it. Prisma's own
 * `$transaction(fn)` satisfies this structurally.
 */
export interface NotificationsDb extends NotificationsDbClient {
  $transaction<T>(fn: (tx: NotificationsDbClient) => Promise<T>): Promise<T>;
}

/** Deferred so hosts with an async client bootstrap can pass it directly. */
export type NotificationsDbProvider = () => Promise<NotificationsDb>;

/**
 * How a transport reaches a person: the destinations the HOST owns.
 *
 * Returning `null` for a user id means "no such recipient", which `notify`
 * treats as a caller bug and throws on — a notification addressed to nobody is
 * never silently dropped.
 */
export interface NotificationContactDirectory {
  getContact(userId: string): Promise<{ email: string | null; phone: string | null } | null>;
}
