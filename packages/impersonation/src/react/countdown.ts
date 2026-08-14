import { useCallback, useEffect, useState } from 'react';

import { subscribeToWake } from './wake';

/**
 * The banner's countdown.
 *
 * EVERY VALUE IS DERIVED FROM THE SERVER'S ABSOLUTE `expiresAt` AND THE CLOCK,
 * never from a number that gets decremented. A ticking counter seeded once at
 * mount drifts on a throttled background tab and is flatly wrong on a laptop
 * that slept — it would come back claiming twenty minutes remain on a session
 * the server closed while the lid was down. Recomputing `expiresAt - now` on
 * every tick means the worst a missed tick can cost is one second of staleness,
 * and a wake-up corrects even that immediately.
 */

/** How often the displayed remainder is recomputed. */
const TICK_MS = 1000;

/** Milliseconds left in the time box, clamped at zero. */
export function remainingMs(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - now);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * `mm:ss`, or `h:mm:ss` past an hour. Rounded UP, so a session with 400 ms left
 * reads "0:01" rather than "0:00" — the bar must not say a session is over while
 * it is still authorizing requests.
 */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const base = `${minutes}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : base;
}

/**
 * Milliseconds remaining on `expiresAt`, or null when there is no session.
 *
 * Ticks once a second and recomputes on wake.
 */
export function useRemainingTime(expiresAt: string | null): number | null {
  const measure = useCallback(
    () => (expiresAt === null ? null : remainingMs(expiresAt, Date.now())),
    [expiresAt],
  );
  const [remaining, setRemaining] = useState<number | null>(measure);

  useEffect(() => {
    const update = (): void => setRemaining(measure());
    update();
    if (expiresAt === null) return undefined;
    const timer = setInterval(update, TICK_MS);
    const stopWaking = subscribeToWake(update);
    return () => {
      clearInterval(timer);
      stopWaking();
    };
  }, [measure, expiresAt]);

  return remaining;
}
