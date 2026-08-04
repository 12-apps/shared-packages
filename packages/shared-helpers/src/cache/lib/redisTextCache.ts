import { Redis } from 'ioredis';

/**
 * Minimal Redis-backed text cache + windowed counter.
 *
 * BEST-EFFORT BY CONTRACT: every operation catches its own failure and
 * degrades — a read outage is a miss (`null`), a write outage is a no-op, a
 * counter outage is `null` so the caller can fail open. Redis being down must
 * cost freshness, never take a request path down with it. `onError` receives
 * every swallowed failure so the host can log it.
 *
 * The client is tuned for that contract: no offline queue (a command issued
 * while disconnected rejects immediately instead of stalling the caller) and
 * one retry per request. Reconnection itself keeps its default backoff.
 */

export interface RedisTextCacheOptions {
  /** `redis://[user:pass@]host:port[/db]`. */
  url: string;
  /** Prepended to every key, so one Redis can carry several concerns. */
  keyPrefix?: string;
  /** Observer for swallowed failures. Default: silent. */
  onError?: (operation: string, error: unknown) => void;
}

export interface RedisTextCache {
  /** The cached text, or `null` on miss AND on outage — the two look the same. */
  get(key: string): Promise<string | null>;
  /** Best-effort write with TTL; an outage is a no-op. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /**
   * Best-effort delete — the invalidation primitive. An outage is a no-op:
   * consumers pair it with a short TTL, so a missed eviction self-heals.
   */
  del(key: string): Promise<void>;
  /**
   * Atomically increment a counter that expires with its window (the fixed
   * window rate-limiter primitive). Returns the count AFTER the increment, or
   * `null` on outage so the caller can fail open.
   */
  incrementWindow(key: string, windowMs: number): Promise<number | null>;
  /** Close the underlying connection (tests, graceful shutdown). */
  quit(): Promise<void>;
}

export function createRedisTextCache(options: RedisTextCacheOptions): RedisTextCache {
  const prefix = options.keyPrefix ?? '';
  const report = options.onError ?? ((): void => undefined);
  const client = new Redis(options.url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // Without a listener an emitted 'error' (e.g. ECONNREFUSED while
  // reconnecting) is an unhandled exception that kills the process.
  client.on('error', (error) => report('connection', error));

  return {
    async get(key: string): Promise<string | null> {
      try {
        return await client.get(prefix + key);
      } catch (error) {
        report('get', error);
        return null;
      }
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      try {
        await client.set(prefix + key, value, 'EX', Math.max(1, Math.ceil(ttlSeconds)));
      } catch (error) {
        report('set', error);
      }
    },

    async del(key: string): Promise<void> {
      try {
        await client.del(prefix + key);
      } catch (error) {
        report('del', error);
      }
    },

    async incrementWindow(key: string, windowMs: number): Promise<number | null> {
      try {
        const namespaced = prefix + key;
        const count = await client.incr(namespaced);
        // Stamp the expiry on the window's first hit only: re-stamping on
        // every increment would let a steady stream keep one window alive
        // forever. Callers put the window index in the key, so a crash between
        // INCR and PEXPIRE strands at most that one dead window's key — it can
        // never freeze a future window's count.
        if (count === 1) await client.pexpire(namespaced, Math.max(1, Math.ceil(windowMs)));
        return count;
      } catch (error) {
        report('incrementWindow', error);
        return null;
      }
    },

    async quit(): Promise<void> {
      try {
        await client.quit();
      } catch (error) {
        report('quit', error);
      }
    },
  };
}
