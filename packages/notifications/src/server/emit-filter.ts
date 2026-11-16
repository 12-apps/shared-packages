import type { NotificationChannel, NotificationEvent } from '../types';

/**
 * Which channels ONE emit may use, decided from the event itself — the host's
 * per-emit hook.
 *
 * {@link NotificationChannelPolicy} answers per TENANT and sees no event, and a
 * generator's `channels` answers per TYPE: neither can say "this order is
 * already being told on another path, so not on this channel". This can. It is
 * handed the event (type, recipient, payload) and the channels that survived
 * preferences, transport support and the plan gate, and answers the ones this
 * emit keeps.
 *
 * It only NARROWS: whatever it answers is intersected with what it was given,
 * so it cannot put back a channel the user, the transport or the plan took
 * away. It runs for platform emits too (no tenant), because the question is
 * about the event, not about billing. A hook that THROWS degrades the way a
 * failed plan gate does, to the free channels of what it was given.
 */
export type NotificationEmitChannelFilter = (
  event: NotificationEvent<unknown>,
  channels: readonly NotificationChannel[],
) => readonly NotificationChannel[] | Promise<readonly NotificationChannel[]>;

/** Where a failing hook reports, the router's own logger. */
interface EmitFilterLogger {
  error(message: string, error: unknown): void;
}

/**
 * Apply the host's per-emit hook. Narrow-only: the answer is intersected with
 * the input, and a throw degrades to `fallback(channels)` — the router passes
 * its free-channels fallback, the one a failed plan gate uses.
 */
export async function applyEmitFilter(
  filter: NotificationEmitChannelFilter | undefined,
  logger: EmitFilterLogger,
  event: NotificationEvent<unknown>,
  channels: NotificationChannel[],
  fallback: (channels: NotificationChannel[]) => NotificationChannel[],
): Promise<NotificationChannel[]> {
  if (!filter || channels.length === 0) return channels;
  try {
    const kept = new Set(await filter(event, channels));
    return channels.filter((channel) => kept.has(channel));
  } catch (error) {
    logger.error(
      `[notifications] emitChannelFilter failed for ${event.type}; degrading to the free channels:`,
      error,
    );
    return fallback(channels);
  }
}
