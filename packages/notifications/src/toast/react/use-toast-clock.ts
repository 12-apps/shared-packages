import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A toast's countdown, which stops while the reader is on it.
 *
 * Paused under the pointer and while focus is inside: a toast that leaves
 * while somebody is reading it, or with their keyboard on its button, takes
 * the button with it. Restarted from the top whenever `restartKey` changes —
 * a replaced or updated toast gets its full time again.
 */
export function useToastClock(
  duration: number | null,
  restartKey: unknown,
  onExpire: () => void,
): { pause: () => void; resume: () => void } {
  const [paused, setPaused] = useState(false);
  const remaining = useRef<number | null>(duration);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    remaining.current = duration;
  }, [duration, restartKey]);

  useEffect(() => {
    if (paused || remaining.current === null) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => expire.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - started));
      }
    };
  }, [paused, duration, restartKey]);

  return {
    pause: useCallback(() => setPaused(true), []),
    resume: useCallback(() => setPaused(false), []),
  };
}
