import { withFileCache } from '../../cache/lib/withFileCache';
import { withMemoryCache } from '../../cache/lib/withMemoryCache';
import { logger } from '../../utils/lib/logger';
import { withConcurrencyLimit } from './concurrencyLimiter';
import { withRateLimit } from './rateLimiter';
import { type SuccessRateStats, withSuccessRateMetrics } from './successRateMetrics';

const onErrorFn = <T>(err: unknown, key: T) => logger.error(`Error fetching ${key}: `, err);

type Fetch<T, V> = (key: T) => Promise<V>;

interface SuccessRateSettings {
  minRequests?: number;
  minSuccessPercent?: number;
  includeLastErrorMessage?: boolean;
  onTrip?: (stats: SuccessRateStats) => void;
  cooldownMs?: number;
}

interface FetcherFactoryOptions<T extends string | number, V> {
  getKey: (key: T) => T;
  fetcher: Fetch<T, V>;
  cacheFileName?: string;
  shouldCache?: (val: V) => boolean;
  onError?: (err: unknown, key: T) => void;
  concurrency?: number; // optional max concurrent underlying fetches
  rateLimit?: { max: number; windowMs?: number }; // optional rate limiting
  enableMemoryCache?: boolean; // default true
  successRate?: SuccessRateSettings;
}

interface ResolvedFetcherOptions<T extends string | number, V>
  extends FetcherFactoryOptions<T, V> {
  shouldCache: (val: V) => boolean;
  onError: (err: unknown, key: T) => void;
  enableMemoryCache: boolean;
  successRate: SuccessRateSettings;
}

const DEFAULT_SUCCESS_RATE: SuccessRateSettings = {
  minRequests: 20,
  minSuccessPercent: 50,
  includeLastErrorMessage: false,
  onTrip: (stats) => logger.warning(`Success rate trip for ${stats.name}: ${stats.successPercent}%`),
  cooldownMs: 60000,
};

/** Default `shouldCache`: anything that is not empty, null or absent is worth keeping. */
const isCacheable = (val: unknown): boolean => val !== '' && val !== undefined && val !== null;

const resolveOptions = <T extends string | number, V>(
  opts: FetcherFactoryOptions<T, V>,
): ResolvedFetcherOptions<T, V> => ({
  ...opts,
  shouldCache: opts.shouldCache ?? isCacheable,
  onError: opts.onError ?? onErrorFn,
  enableMemoryCache: opts.enableMemoryCache ?? true,
  successRate: opts.successRate ?? DEFAULT_SUCCESS_RATE,
});

const successRateLayer = <T extends string | number, V>(
  next: Fetch<T, V>,
  settings: SuccessRateSettings,
  fetcherName: string,
): Fetch<T, V> =>
  withSuccessRateMetrics<[T], V>(async (k: T) => next(k), {
    ...settings,
    name: `fetcher:${fetcherName || 'anonymous'}`,
  });

const memoryLayer = <T extends string | number, V>(
  next: Fetch<T, V>,
  opts: ResolvedFetcherOptions<T, V>,
): Fetch<T, V> => {
  const layer = withMemoryCache<[T], T, V>({
    fetcher: (k: T) => next(k),
    getKey: (k: T) => opts.getKey(k),
    onError: opts.onError,
    shouldCacheEmpty: true,
  });
  return (k: T) => layer(k) as Promise<V>;
};

const fileLayer = <T extends string | number, V>(
  next: Fetch<T, V>,
  opts: ResolvedFetcherOptions<T, V>,
  fileName: string,
): Fetch<T, V> => {
  const layer = withFileCache<[T], T, V>({
    fileName,
    getKey: (k: T) => opts.getKey(k),
    fetcher: (k: T) => next(k) as Promise<V>,
    shouldCache: (val) => opts.shouldCache(val as V),
    onError: opts.onError,
  });
  return (k: T) => layer(k) as Promise<V>;
};

// Each enabled layer wraps the one built before it, so the last one added is the
// first consulted: a call goes file cache -> memory cache -> rate limiter ->
// concurrency gate -> success-rate guard -> the real fetcher. The guard sits
// innermost deliberately, so it only counts calls that a cache did not answer.
const buildFetcher = <T extends string | number, V>(
  opts: ResolvedFetcherOptions<T, V>,
): Fetch<T, V> => {
  const { concurrency, rateLimit, cacheFileName } = opts;
  let next: Fetch<T, V> = opts.fetcher;

  if (opts.successRate) {
    next = successRateLayer(next, opts.successRate, opts.fetcher.name);
  }
  if (concurrency && concurrency > 0) {
    const prev = next;
    next = withConcurrencyLimit<[T], V>(concurrency, async (k: T) => prev(k));
  }
  if (rateLimit && rateLimit.max > 0) {
    const prev = next;
    next = withRateLimit<[T], V>(rateLimit, async (k: T) => prev(k));
  }
  if (opts.enableMemoryCache) {
    next = memoryLayer(next, opts);
  }
  if (cacheFileName) {
    next = fileLayer(next, opts, cacheFileName);
  }

  return next;
};

/**
 * Generic factory that creates a 2‑tier (in‑memory + persistent) cached fetcher.
 * Encapsulates the previous verbose pattern used for getUserGrp.
 */
/**
 * createFetcherFactory
 * ---------------------------------
 * Builds a cached fetcher function with optional:
 *  - Concurrency limiting (in-flight cap)
 *  - Rate limiting (requests per time window)
 *  - In‑memory cache (fast, de-dupes concurrent calls, optional TTL handled inside wrappers)
 *  - Persistent file cache (disabled in current implementation unless re-enabled)
 *
 * Layers are composed in this order (if enabled):
 *   raw fetcher -> concurrency limiter -> rate limiter -> memory cache -> (persistent cache)
 *
 * The final object exposes a single method:
 *   get(key) -> Promise<V>
 * which returns the cached (or freshly fetched) value for the provided key.
 *
 * Type Parameters:
 *   T - key type (string | number)
 *   V - value type (defaults to string | undefined)
 *
 * @param opts Configuration object
 * @param opts.getKey Function deriving the canonical cache key from the supplied key
 * @param opts.fetcher Underlying async function that retrieves the value (only called on cache miss)
 * @param [opts.fileName] File name for persistent cache (currently ignored unless persistent cache is reintroduced)
 * @param [opts.shouldCache] Predicate deciding if a value should be cached (default: non-empty / non-null)
 * @param [opts.onError] Error hook (receives error + key)
 * @param [opts.concurrency] Max number of concurrent underlying fetcher executions
 * @param [opts.rateLimit] Rate limiting config { max, windowMs }
 * @param [opts.enableMemoryCache=true] Enable the in‑memory cache layer
 *
 * @returns { get: (key: T) => Promise<V> }
 *
 * @example
 * const { get: getUserName } = createFetcherFactory({
 *   getKey: id => id,
 *   fetcher: async (id) => api.fetchUserName(id),
 *   concurrency: 5,
 *   rateLimit: { max: 100, windowMs: 60_000 },
 *   enableMemoryCache: true
 * });
 *
 * const name = await getUserName(42);
 */
export const createFetcherFactory = <T extends string | number, V = string | undefined>(
  opts: FetcherFactoryOptions<T, V>,
) => {
  const baseFetcher = buildFetcher(resolveOptions(opts));
  const debug = !!process.env.CACHE_DEBUG;
  const get = async (key: T): Promise<V> => {
    const val = (await baseFetcher(key)) as V;
    if (debug) {
      logger.info(`[cache] key=${String(key)} => ${(val)?.toString?.().slice(0, 40)}`);
    }
    return val;
  };

  return { get };
};
