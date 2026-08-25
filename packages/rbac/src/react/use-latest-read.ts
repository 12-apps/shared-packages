'use client';

import { useRef } from 'react';

/**
 * "Only the LATEST read may write."
 *
 * Both screens sit on a server-driven grid, so every keystroke starts a fetch
 * and two can be in flight at once. They can also answer out of order — and
 * when they do, the slower one landing last puts an OLDER page on screen with
 * nothing anywhere to say so. No error, no spinner, just the wrong rows under
 * the right query.
 *
 * The fix is three lines each time, which is exactly why it does not belong in
 * two places: a loader that lost the guard would look completely normal, pass
 * every test that does not race, and be wrong only under a fast typist.
 */
export interface LatestRead {
  /** Stamp a read as it starts. Call once, synchronously, before the fetch. */
  claim: () => number;
  /** Whether this read is still the newest — false means DROP the result. */
  isCurrent: (ticket: number) => boolean;
}

export function useLatestRead(): LatestRead {
  const latest = useRef(0);
  return {
    claim: () => ++latest.current,
    isCurrent: (ticket) => ticket === latest.current,
  };
}
