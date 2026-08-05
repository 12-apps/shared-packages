/**
 * withSuccessRateMetrics
 * Wrap an async function and enforce a minimum success rate after a minimum
 * number of attempts. If (totalCalls >= minRequests) AND (success% < minSuccessPercent),
 * the circuit "trips": it throws an error for the triggering call and all future calls.
 */
export interface SuccessRateOptions {
  /** Minimum number of total requests before evaluation (default 20) */
  minRequests?: number;
  /** Minimum success percentage required to keep allowing calls (default 50) */
  minSuccessPercent?: number; // expressed 0-100
  /** Optional hook invoked when trip condition met */
  onTrip?: (stats: SuccessRateStats) => void;
  /** Name for diagnostics */
  name?: string;
  /** If true, include last error message in the thrown TripError */
  includeLastErrorMessage?: boolean;
  /** Optional cooldown in ms after which the circuit will auto-reset allowing new attempts */
  cooldownMs?: number;
}

export interface SuccessRateStats {
  name?: string;
  total: number;
  success: number;
  failures: number;
  successPercent: number; // 0-100
  tripped: boolean;
  minRequests: number;
  minSuccessPercent: number;
  lastError?: unknown;
}

export class SuccessRateTripError extends Error {
  readonly stats: SuccessRateStats;
  constructor(message: string, stats: SuccessRateStats) {
    super(message);
    this.name = 'SuccessRateTripError';
    this.stats = stats;
  }
}

// One guard's counters. They used to be `let`s in the factory closure, which made
// the factory a single 87-line function; naming the record lets the operations
// below be read one at a time.
interface SuccessRateState {
  name?: string;
  minRequests: number;
  minSuccessPercent: number;
  total: number;
  success: number;
  failures: number;
  tripped: boolean;
  lastError?: unknown;
  tripAt?: number;
}

const computeStats = (state: SuccessRateState): SuccessRateStats => ({
  name: state.name,
  total: state.total,
  success: state.success,
  failures: state.failures,
  successPercent: state.total === 0 ? 100 : (state.success / state.total) * 100,
  tripped: state.tripped,
  minRequests: state.minRequests,
  minSuccessPercent: state.minSuccessPercent,
  lastError: state.lastError,
});

const resetCounters = (state: SuccessRateState): void => {
  state.total = 0;
  state.success = 0;
  state.failures = 0;
  state.tripped = false;
  state.lastError = undefined;
  state.tripAt = undefined;
};

const lastErrorSuffix = (stats: SuccessRateStats, include?: boolean): string => {
  if (!include || !stats.lastError) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = (stats.lastError as any)?.message;
  return `; last error: ${message || String(stats.lastError)}`;
};

const maybeTrip = (state: SuccessRateState, opts: SuccessRateOptions): void => {
  if (state.tripped) return;
  if (state.total < state.minRequests) return; // not enough samples yet
  const rate = (state.success / state.total) * 100;
  if (rate >= state.minSuccessPercent) return;

  state.tripped = true;
  state.tripAt = Date.now();
  const stats = computeStats(state);
  opts.onTrip?.(stats);
  // Throwing here affects ONLY the current call; future calls will fast-fail at top.
  throw new SuccessRateTripError(
    `Success rate ${rate.toFixed(2)}% below required ${state.minSuccessPercent}% after ` +
      `${state.total} calls${lastErrorSuffix(stats, opts.includeLastErrorMessage)}`,
    stats,
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withSuccessRateMetrics<Args extends any[], R>(
  fn: (...args: Args) => Promise<R>,
  opts: SuccessRateOptions = {},
) {
  const state: SuccessRateState = {
    name: opts.name,
    minRequests: opts.minRequests ?? 20,
    minSuccessPercent: opts.minSuccessPercent ?? 50,
    total: 0,
    success: 0,
    failures: 0,
    tripped: false,
  };

  const cooldownElapsed = (): boolean =>
    Boolean(opts.cooldownMs && state.tripAt && Date.now() - state.tripAt >= opts.cooldownMs);

  const wrapped = async (...args: Args): Promise<R> => {
    if (state.tripped) {
      // If cooldown configured and elapsed, auto-reset and continue.
      if (!cooldownElapsed()) {
        throw new SuccessRateTripError(
          `Success rate guard already tripped for ${state.name || 'unnamed fetcher'}`,
          computeStats(state),
        );
      }
      resetCounters(state);
    }

    try {
      const result = await fn(...args);
      state.total++;
      state.success++;
      maybeTrip(state, opts);
      return result;
    } catch (err) {
      state.total++;
      state.failures++;
      state.lastError = err;
      maybeTrip(state, opts);
      throw err;
    }
  };

  // Introspection helpers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (wrapped as any).getSuccessRateStats = () => computeStats(state);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (wrapped as any).resetSuccessRateStats = () => resetCounters(state);

  return wrapped as ((...args: Args) => Promise<R>) & {
    getSuccessRateStats: () => SuccessRateStats;
    resetSuccessRateStats: () => void;
  };
}

// Convenience wrapper for fetcher factories: apply after constructing the fetcher.
export function applySuccessRateGuard<T extends string | number, V>(
  fetcher: (key: T) => Promise<V>,
  opts?: SuccessRateOptions,
) {
  return withSuccessRateMetrics(fetcher, { ...opts, name: opts?.name || 'fetcher' });
}
