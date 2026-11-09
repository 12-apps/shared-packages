import { useEffect, useRef } from 'react';

import type { UploadProgressValue } from './UploadProgress.types';

/**
 * Seconds as a person should read them: rounded UP (never "0 s" while
 * something still runs), and never shown going up by more than one second
 * between two renders of the same stage — a jumpy estimate reads as broken.
 *
 * The last shown value is committed in an effect, not during render, so a
 * render React repeats (Strict Mode) computes the same number twice.
 */
export function useSteadySeconds(raw: number | null, resetKey: string): number | null {
  const committed = useRef<{ key: string; shown: number | null }>({ key: resetKey, shown: null });
  const previous = committed.current.key === resetKey ? committed.current.shown : null;
  const rounded = raw === null || !Number.isFinite(raw) ? null : Math.max(1, Math.ceil(raw));
  const shown = rounded !== null && previous !== null && rounded > previous + 1 ? previous + 1 : rounded;

  useEffect(() => {
    committed.current = { key: resetKey, shown };
  }, [resetKey, shown]);

  return shown;
}

/** Which time line a stage shows, and its number before steadying. */
export function timeLeftOf(progress: UploadProgressValue | null): { kind: 'stage' | 'total'; raw: number } | null {
  if (!progress || progress.stage === 'saving' || progress.fraction === null) return null;
  if (progress.stage === 'preparing' && progress.totalSecondsLeft != null) {
    return { kind: 'total', raw: progress.totalSecondsLeft };
  }
  return progress.secondsLeft === null ? null : { kind: 'stage', raw: progress.secondsLeft };
}

/**
 * The time line `UploadProgress` shows, as `{ kind, seconds }` — for a caller
 * that draws the compact bar and puts the time beside it in its own slot, so
 * both read the same steadied number.
 */
export function useUploadTimeLeft(
  progress: UploadProgressValue | null,
): { kind: 'stage' | 'total'; seconds: number } | null {
  const line = timeLeftOf(progress);
  const key = `${progress?.stage ?? 'idle'}:${line?.kind ?? 'none'}`;
  const seconds = useSteadySeconds(line?.raw ?? null, key);
  return line && seconds !== null ? { kind: line.kind, seconds } : null;
}
