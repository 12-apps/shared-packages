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
 *
 * NOT READY IS SKIPPED, NOT ATTEMPTED (FUT-2212). Without the offline queue,
 * ioredis refuses every command issued before its connection is `ready` with
 * "Stream isn't writeable and enableOfflineQueue options is false" — and a new
 * process always serves its first requests in that window. Each of those was
 * reported as a failure, so every deploy logged a burst of errors for a Redis
 * that was perfectly healthy. Now an operation checks the client's status
 * first and, when it is not `ready`, answers the same degraded value an outage
 * answers (a miss, a no-op, `null`) without touching the client:
 *
 * - while the client is still on its FIRST connection attempt, silently;
 * - after that (the connection failed, or dropped and is reconnecting), as a
 *   reported outage — but at most once per `unavailableReportIntervalMs`, so a
 *   down Redis is visible without one log line per command. The connection's
 *   own errors are still reported as they arrive, under `connection`.
 *
 * The offline queue stays off on purpose: with it on, every request would wait
 * behind a Redis that is down, turning a short Redis loss into a stalled site.
 * A caller that must not degrade in the boot window — a single-use guard that
 * fails closed on `null` — awaits `whenReady(timeoutMs)` first instead: a
 * bounded wait for the handshake, which a down Redis still ends at the bound.
 */

export interface RedisTextCacheOptions {
  /** `redis://[user:pass@]host:port[/db]`. */
  url: string;
  /** Prepended to every key, so one Redis can carry several concerns. */
  keyPrefix?: string;
  /** Observer for swallowed failures. Default: silent. */
  onError?: (operation: string, error: unknown) => void;
  /**
   * The least time between two reports of an operation skipped because the
   * client is not ready (after its first connection attempt). Default: 60 s.
   */
  unavailableReportIntervalMs?: number;
}

/** `whenReady`'s bound when the caller names none. */
export const DEFAULT_REDIS_READY_TIMEOUT_MS = 2_000;
const DEFAULT_UNAVAILABLE_REPORT_INTERVAL_MS = 60_000;

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
  /**
   * Resolves `true` as soon as the client is ready to take commands, `false`
   * when it is not ready within `timeoutMs` (default
   * {@link DEFAULT_REDIS_READY_TIMEOUT_MS}) or has closed for good. Never
   * rejects. For callers that must not read the boot window's skipped
   * operations as an outage; everyone else just calls the operation.
   */
  whenReady(timeoutMs?: number): Promise<boolean>;
  /** Close the underlying connection (tests, graceful shutdown). */
  quit(): Promise<void>;
}

interface ReadinessGate {
  /**
   * Whether `operation` may reach the client. When it may not, the skip is
   * reported only past the first connection attempt and only once per interval.
   */
  usable(operation: string): boolean;
  whenReady(timeoutMs?: number): Promise<boolean>;
}

/**
 * The not-ready half of the contract: which operations may reach the client,
 * which skips are worth a report, and the bounded wait for `ready`. It also
 * installs the client's `error` listener — without one an emitted `error`
 * (e.g. ECONNREFUSED while reconnecting) is an unhandled exception that kills
 * the process.
 */
function readinessGate(
  client: Redis,
  report: (operation: string, error: unknown) => void,
  reportIntervalMs: number,
): ReadinessGate {
  // Set by the first `ready` or the first connection error, whichever comes
  // first: until then a not-ready client is a process still booting, not an outage.
  let firstConnectSettled = false;
  let lastUnavailableReportAt = Number.NEGATIVE_INFINITY;
  client.on('error', (error) => {
    firstConnectSettled = true;
    report('connection', error);
  });
  client.on('ready', () => {
    firstConnectSettled = true;
  });

  return {
    usable(operation: string): boolean {
      if (client.status === 'ready') return true;
      if (!firstConnectSettled) return false;
      const now = Date.now();
      if (now - lastUnavailableReportAt >= reportIntervalMs) {
        lastUnavailableReportAt = now;
        report(operation, new Error(`redis is not ready (status: ${client.status}); skipping the cache`));
      }
      return false;
    },

    whenReady(timeoutMs: number = DEFAULT_REDIS_READY_TIMEOUT_MS): Promise<boolean> {
      if (client.status === 'ready') return Promise.resolve(true);
      if (client.status === 'end') return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const settle = (ready: boolean): void => {
          clearTimeout(timer);
          client.off('ready', onReady);
          client.off('end', onEnd);
          resolve(ready);
        };
        const onReady = (): void => settle(true);
        const onEnd = (): void => settle(false);
        const timer = setTimeout(() => settle(false), Math.max(0, timeoutMs));
        client.once('ready', onReady);
        client.once('end', onEnd);
      });
    },
  };
}

export function createRedisTextCache(options: RedisTextCacheOptions): RedisTextCache {
  const prefix = options.keyPrefix ?? '';
  const report = options.onError ?? ((): void => undefined);
  const reportInterval = options.unavailableReportIntervalMs ?? DEFAULT_UNAVAILABLE_REPORT_INTERVAL_MS;
  const client = new Redis(options.url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const gate = readinessGate(client, report, reportInterval);

  return {
    async get(key: string): Promise<string | null> {
      if (!gate.usable('get')) return null;
      try {
        return await client.get(prefix + key);
      } catch (error) {
        report('get', error);
        return null;
      }
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      if (!gate.usable('set')) return;
      try {
        await client.set(prefix + key, value, 'EX', Math.max(1, Math.ceil(ttlSeconds)));
      } catch (error) {
        report('set', error);
      }
    },

    async del(key: string): Promise<void> {
      if (!gate.usable('del')) return;
      try {
        await client.del(prefix + key);
      } catch (error) {
        report('del', error);
      }
    },

    async incrementWindow(key: string, windowMs: number): Promise<number | null> {
      if (!gate.usable('incrementWindow')) return null;
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

    whenReady: gate.whenReady,

    async quit(): Promise<void> {
      try {
        await client.quit();
      } catch (error) {
        report('quit', error);
      }
    },
  };
}
