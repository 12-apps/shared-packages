/**
 * A sliding-window limiter, in process. Enough for what it guards — a person
 * flooding a thread — and deliberately not a distributed quota: several
 * processes each allowing `max` is still a bounded nuisance, and the limit is a
 * courtesy, not a security boundary (the host's guard and `canWrite` are).
 */
export interface SlidingWindow {
  /** Records a hit and answers whether it fits; a refused hit is not recorded. */
  take(key: string, max: number, windowMs: number, now: number): boolean;
}

/** How many takes between sweeps of keys nobody has hit within their window. */
const SWEEP_EVERY = 500;

export function createSlidingWindow(): SlidingWindow {
  const hits = new Map<string, { at: number[]; windowMs: number }>();
  let takes = 0;
  const sweep = (now: number): void => {
    for (const [key, entry] of hits) {
      if (entry.at.every((at) => now - at >= entry.windowMs)) hits.delete(key);
    }
  };
  return {
    take(key, max, windowMs, now) {
      takes += 1;
      if (takes % SWEEP_EVERY === 0) sweep(now);
      const recent = (hits.get(key)?.at ?? []).filter((at) => now - at < windowMs);
      const fits = recent.length < max;
      if (fits) recent.push(now);
      hits.set(key, { at: recent, windowMs });
      return fits;
    },
  };
}
