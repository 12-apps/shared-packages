export interface RetryOptions {
  /** Number of retry attempts AFTER the first try. Default 3 (total attempts = retries + 1). */
  retries?: number;
  /** Base delay in milliseconds for the first backoff (default 2000 ms = 2s). */
  baseDelayMs?: number;
  /** Exponential factor (default 2). */
  factor?: number;
  /** Optional max delay cap in ms. */
  maxDelayMs?: number;
  /** Optional hook to decide if an error is retryable. Return false to stop retrying. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called right before a retry wait. */
  onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void;
}

const defaultShouldRetry = () => true;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a task with exponential backoff retry. Delays sequence (default): 2s, 4s, 8s ...
 * Example delays: baseDelayMs * factor^(attempt-1) where attempt starts at 1 for first retry.
 */
const RETRY_DEFAULTS = {
  retries: 3,
  baseDelayMs: 2000,
  factor: 2,
  shouldRetry: defaultShouldRetry,
};

// Strips explicitly-undefined options before the merge, so `{ retries: undefined }`
// still falls back to the default exactly as a destructuring default would.
const withDefaults = (options?: RetryOptions) => ({
  ...RETRY_DEFAULTS,
  ...(Object.fromEntries(
    Object.entries(options ?? {}).filter(([, value]) => value !== undefined),
  ) as RetryOptions),
});

const delayFor = (
  attempt: number,
  baseDelayMs: number,
  factor: number,
  maxDelayMs?: number,
): number => {
  const base = baseDelayMs * Math.pow(factor, attempt); // attempt 0 -> baseDelayMs
  return maxDelayMs ? Math.min(base, maxDelayMs) : base;
};

export async function withRetry<T>(task: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const { retries, baseDelayMs, factor, maxDelayMs, shouldRetry, onRetry } = withDefaults(options);

  let attempt = 0; // 0 = first attempt
  while (true) {
    try {
      return await task();
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err, attempt)) {
        throw err;
      }

      const delay = delayFor(attempt, baseDelayMs, factor, maxDelayMs);
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
      attempt++;
    }
  }
}
