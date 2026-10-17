import { AsyncLocalStorage } from 'node:async_hooks';

import {
  installTrafficContext,
  trafficContext,
  type RecordedHttpCall,
} from '../../core/traffic-recorder';

/**
 * The server half of the traffic recorder (FUT-3696): the AsyncLocalStorage
 * that `core/traffic-recorder.ts` may not import itself, because the root
 * entry reaches that module and must stay free of Node builtins. Loading this
 * module installs it; it ships only at the `./homologacao-evidence` subpath.
 */
if (!trafficContext()) installTrafficContext(new AsyncLocalStorage<RecordedHttpCall[]>());

/** What {@link recordTraffic} hands back: the outcome, plus every call made. */
export type RecordedOutcome<T> =
  | { ok: true; value: T; calls: RecordedHttpCall[] }
  | { ok: false; error: unknown; calls: RecordedHttpCall[] };

/**
 * Run `fn` and return every adapter call it made, redacted. Never throws: a
 * failing call is evidence too, and the caller decides what it means.
 */
export async function recordTraffic<T>(fn: () => Promise<T>): Promise<RecordedOutcome<T>> {
  const calls: RecordedHttpCall[] = [];
  const context = trafficContext();
  try {
    const value = context ? await context.run(calls, fn) : await fn();
    return { ok: true, value, calls };
  } catch (error) {
    return { ok: false, error, calls };
  }
}
