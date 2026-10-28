import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The live region's sentence, for the week grid and the day ruler (FUT-3825).
 *
 * The region stays mounted: a screen reader watches the node it found, and a
 * region swapped for a new one per sentence is announced unreliably or not at
 * all. Each sentence clears the region first and is written on the next frame,
 * so the same sentence twice ("refused", "refused") is a change both times.
 */
export function useAnnouncer(): { text: string; say: (text: string) => void } {
  const [text, setText] = useState('');
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const say = useCallback((next: string): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    setText('');
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setText(next);
    });
  }, []);

  return { text, say };
}
