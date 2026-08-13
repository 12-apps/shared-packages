import { useEffect, useState } from 'react';

/**
 * The host's side of the consent accelerator (12-18).
 *
 * `@12-apps/app-shell` takes this as a hook — `consent.useSignal` — precisely so it
 * carries no realtime client of its own: `@12-apps/realtime` owns that, and two
 * implementations of one bus is the drift this series keeps finding. A real adopter's
 * implementation is one line over its event system:
 *
 *   useSignal: (onSignal) => events.useUserTopics({ topics: ['consent'], onMessage: onSignal })
 *
 * This harness needs no socket to prove the seam, and deliberately does not open one:
 * what the package promises is that a CONNECT re-asks and a HINT re-asks, and both are
 * observable from a plain emitter a spec can fire. Wiring a real gateway here would
 * test `@12-apps/realtime` a second time and this seam not at all.
 */

type Listener = () => void;

/** A one-line emitter, module-scoped so a page control and the hook share it. */
export const CONSENT_SIGNAL = {
  listeners: new Set<Listener>(),
  /** What a pushed "terms may have changed" hint does. */
  fire(): void {
    for (const listener of this.listeners) listener();
  },
};

/**
 * Reports `connected: true` after mount, which is the interesting half.
 *
 * A real channel is `connecting` before it is `connected`, and the package re-asks on
 * the TRANSITION — that is what turns a deploy's restart into the notification. So
 * this starts false and flips in an effect, rather than being born connected: a seam
 * that was never anything but `true` would never exercise the transition at all.
 */
export function useConsentSignal(onSignal: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    CONSENT_SIGNAL.listeners.add(onSignal);
    return () => {
      CONSENT_SIGNAL.listeners.delete(onSignal);
    };
  }, [onSignal]);

  useEffect(() => {
    setConnected(true);
  }, []);

  return { connected };
}
