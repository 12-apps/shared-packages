import { messagesOf, type NotificationsCopySource, type NotificationWireMessages } from '../messages';
import type { NotificationChannel } from '../types';

import type { ConsentEngine } from './consent';
import { isPaidChannel, PAID_CHANNELS, type PaidChannel } from './consent-text';
import { guarded, NotificationsApiError, ok, type NotificationsRoute } from './context';

/**
 * The two phone-confirmation endpoints, mounted only when the host
 * configured `consent` — a host that did not sees exactly the routes it saw
 * before. Both are self-scoped: they confirm the CALLER's number, never another
 * account's, even one sharing the number.
 *
 * The answer is the engine's status in `{ data }`, a cooldown included: the
 * screen counts it down, so it is data, not an error. Only a malformed body is
 * a 400.
 */

interface ConsentRoutesDeps {
  consent: ConsentEngine;
  messages: NotificationsCopySource<NotificationWireMessages>;
}

function bodyRecord(body: unknown, messages: NotificationWireMessages): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return body as Record<string, unknown>;
}

function channelOf(record: Record<string, unknown>, messages: NotificationWireMessages): PaidChannel {
  if (!isPaidChannel(record.channel)) throw new NotificationsApiError(400, messages.invalidBody);
  return record.channel;
}

/** `{ channel }` — a paid channel, spelled exactly. */
function parseResendBody(body: unknown, messages: NotificationWireMessages): PaidChannel {
  return channelOf(bodyRecord(body, messages), messages);
}

/** `{ channel, code }` — the code is exactly six digits. */
function parseCodeBody(
  body: unknown,
  messages: NotificationWireMessages,
): { channel: PaidChannel; code: string } {
  const record = bodyRecord(body, messages);
  const channel = channelOf(record, messages);
  if (typeof record.code !== 'string' || !/^\d{6}$/.test(record.code)) {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return { channel, code: record.code };
}

type Toggles = Record<string, Partial<Record<NotificationChannel, boolean>> | undefined>;

/**
 * The paid channels a preferences save switched ON — false → true against what
 * the person had (`before`, their effective matrix), in any category. A
 * payload that merely RESTATES an on switch (a client that PUTs the whole
 * matrix on every save) asks nothing: re-asking there sent a paid prompt to an
 * opted-out number on every unrelated save. Without `before`, every true
 * counts (the caller has not read the stored preferences yet).
 */
export function paidChannelsTurnedOn(saved: Toggles, before?: Toggles): PaidChannel[] {
  return PAID_CHANNELS.filter((channel) =>
    Object.entries(saved).some(
      ([category, toggles]) =>
        toggles?.[channel] === true && (before === undefined || (before[category] !== undefined && before[category]?.[channel] !== true)),
    ),
  );
}

export function consentRoutes(deps: ConsentRoutesDeps): NotificationsRoute[] {
  return [
    {
      method: 'POST',
      path: '/phone-confirmation/resend',
      handle: guarded(async ({ actor, body, locale }) => {
        const channel = parseResendBody(body, messagesOf(deps, locale));
        return ok(await deps.consent.resend(actor.userId, channel));
      }),
    },
    {
      method: 'POST',
      path: '/phone-confirmation/code',
      handle: guarded(async ({ actor, body, locale }) => {
        const { channel, code } = parseCodeBody(body, messagesOf(deps, locale));
        return ok(await deps.consent.confirmCode(actor.userId, channel, code));
      }),
    },
  ];
}
