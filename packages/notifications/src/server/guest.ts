import { UnknownNotificationRecipientError } from '../errors';
import { capToAvailable } from '../preferences-core';
import type { NotificationChannel, NotificationGuestEvent, NotificationGenerator } from '../types';

import { dispatchOne } from './dispatch';
import { guestRecipient } from './guest-recipient';
import {
  applyPolicy,
  sideFor,
  type NotificationRouterDeps,
  type NotifyOptions,
  type NotifyResult,
} from './router';

/**
 * `notifyGuest` — the emit for a GUEST: a person with a phone and no account,
 * told about something a store holds for them (a place in a queue, taken at
 * the door).
 *
 * The host's call IS the consent decision: a guest asked, at the door, to be
 * told on this phone about this place, and nothing else ever reaches them. So
 * what a guest may get is narrower than an account, never wider:
 *
 *   - only the paid phone channels the TYPE declares (`generator.channels`,
 *     required — a type that never said which channels it uses is never sent to
 *     a stranger's phone), and none the host requires a confirmation on (a
 *     guest has no account to confirm from);
 *   - the store's plan gate (`channelPolicy`), as for any tenant emit;
 *   - never past a STOP the number gave (on any account, or as a guest), here
 *     and again before every send;
 *   - within the caps: the number's day (counted on `guest:<E.164>`) and the
 *     store's month.
 *
 * Not applied, on purpose: preferences (a guest has none) and the host's
 * per-emit hook (`emitChannelFilter`, which reads an account).
 *
 * The row is written with no `userId` and the phone in `recipientPhone`, so
 * it is in nobody's inbox, and nothing is announced to `onCommitted` (an inbox
 * listener has nobody to refresh).
 */

/** The channels a guest can be reached on at all: a phone's. */
const GUEST_CHANNELS: readonly NotificationChannel[] = ['SMS', 'WHATSAPP'];

/** A guest's caps subject: the number, apart from any account id. */
export const guestCapsSubject = (destination: string): string => `guest:${destination}`;

/** What the mount must have wired for a guest send to honour a STOP. */
export interface GuestNotifyDeps extends NotificationRouterDeps {
  guestDestination?: (phone: string) => string | null;
}

/** The channels this guest emit will enqueue (see the header). */
async function guestChannels(
  deps: GuestNotifyDeps,
  event: NotificationGuestEvent<unknown>,
  generator: Pick<NotificationGenerator<never>, 'channels'>,
  destination: string,
  recipient: ReturnType<typeof guestRecipient>,
): Promise<NotificationChannel[]> {
  const declared = capToAvailable([...GUEST_CHANNELS], generator.channels);
  const supported = declared.filter(
    (channel) => deps.transports.get(channel)?.supports(recipient) === true,
  );
  const permitted = await applyPolicy(deps, event.recipient.clientId, supported);
  const kept = capToAvailable(permitted, generator.channels).filter((channel) =>
    GUEST_CHANNELS.includes(channel),
  );
  const open = deps.guestGate ? await deps.guestGate(destination, kept) : [];
  return deps.caps
    ? deps.caps.apply(guestCapsSubject(destination), event.recipient.clientId, open)
    : open;
}

/** Refuse the emits a guest must never receive, before anything is written. */
function guestPreconditions(
  deps: GuestNotifyDeps,
  event: NotificationGuestEvent<unknown>,
  generator: NotificationGenerator<never>,
): string {
  if (!deps.guestGate || !deps.guestDestination) {
    throw new Error(
      "@12-apps/notifications: notifyGuest() needs `consent` configured — a guest's STOP is kept and checked there.",
    );
  }
  if (!generator.channels) {
    throw new Error(
      `@12-apps/notifications: ${event.type} declares no channels; a guest is only sent the channels a type declares.`,
    );
  }
  const destination = deps.guestDestination(event.recipient.phone);
  if (!destination) throw new UnknownNotificationRecipientError(`guest:${event.recipient.phone}`);
  return destination;
}

export function createGuestNotify(deps: GuestNotifyDeps) {
  return async function notifyGuest<TPayload>(
    event: NotificationGuestEvent<TPayload>,
    options: NotifyOptions = {},
  ): Promise<NotifyResult> {
    const generator = deps.generators.resolve(event.type);
    const destination = guestPreconditions(deps, event, generator);
    const side = sideFor(deps, event.type);
    const recipient = guestRecipient(
      destination,
      event.recipient.clientId,
      side,
      event.recipient.locale,
    );
    const content = generator.generate(event.payload as never, {
      locale: recipient.locale,
    });
    const channels = await guestChannels(deps, event, generator, destination, recipient);

    const client = await deps.db();
    const notification = await client.$transaction(async (tx) => {
      const created = await tx.notification.create({
        data: {
          userId: null,
          recipientPhone: destination,
          clientId: event.recipient.clientId,
          side,
          type: event.type,
          category: generator.category,
          title: content.title,
          body: content.body,
          link: content.link ?? null,
          data: content.data ?? {},
        },
      });
      if (channels.length > 0) {
        await tx.notificationDelivery.createMany({
          data: channels.map((channel) => ({
            notificationId: created.id,
            channel,
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    if (options.sync) {
      await dispatchOne(deps, notification.id);
      return { notificationId: notification.id, channels };
    }
    void (
      deps.scheduleDispatch
        ? deps.scheduleDispatch(notification.id)
        : dispatchOne(deps, notification.id)
    ).catch((error: unknown) =>
      deps.logger.error(`[notifications] dispatch failed for ${notification.id}:`, error),
    );
    return { notificationId: notification.id, channels };
  };
}
