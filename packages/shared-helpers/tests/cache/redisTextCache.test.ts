import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Redis text cache's contract is its FAILURE shape (FUT-416): a consumer
 * binds it as a best-effort cache/limiter backend, so an outage must read as a
 * miss / a no-op / "fail open" — never as a thrown error. ioredis is mocked;
 * what is pinned is what each operation does with the client and with the
 * client's failures.
 */

const { mockRedis, redisCtor } = vi.hoisted(() => {
  // `status` and the event surface are the parts of ioredis the readiness gate
  // reads; `emitter` is attached in `beforeEach`, where node:events is loaded.
  const mockRedis = {
    status: 'ready',
    emitter: null as unknown as EventEmitter,
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    pexpire: vi.fn(),
    quit: vi.fn(),
  };
  return { mockRedis, redisCtor: vi.fn(() => mockRedis) };
});

vi.mock('ioredis', () => ({ Redis: redisCtor }));

import { createRedisTextCache } from '../../src/cache/lib/redisTextCache';

/**
 * What ioredis does with `enableOfflineQueue: false` when a command is issued
 * before the connection is `ready`: it rejects at once with this literal (the
 * one FUT-2212 counted on every new container in production).
 */
const NOT_WRITEABLE = "Stream isn't writeable and enableOfflineQueue options is false";

function rejectUnlessReady<T>(value: T): () => Promise<T> {
  return () =>
    mockRedis.status === 'ready' ? Promise.resolve(value) : Promise.reject(new Error(NOT_WRITEABLE));
}

/** Move the mocked client to an ioredis connection status. */
function setClientStatus(status: string): void {
  mockRedis.status = status;
}

/** The client finishing its handshake, as ioredis reports it. */
function becomeReady(): void {
  setClientStatus('ready');
  mockRedis.emitter.emit('ready');
}

/** The client closing for good (no more reconnection attempts). */
function closeForGood(): void {
  setClientStatus('end');
  mockRedis.emitter.emit('end');
}

/** The connection attempt failing, as ioredis reports it. */
function failToConnect(): void {
  setClientStatus('reconnecting');
  mockRedis.emitter.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.status = 'ready';
  mockRedis.emitter = new EventEmitter();
  mockRedis.on.mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
    mockRedis.emitter.on(event, listener);
    return mockRedis;
  });
  mockRedis.once.mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
    mockRedis.emitter.once(event, listener);
    return mockRedis;
  });
  mockRedis.off.mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
    mockRedis.emitter.off(event, listener);
    return mockRedis;
  });
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.pexpire.mockResolvedValue(1);
  mockRedis.quit.mockResolvedValue('OK');
});

describe('createRedisTextCache', () => {
  it('connects without an offline queue so a dead Redis fails fast, and absorbs error events', () => {
    createRedisTextCache({ url: 'redis://localhost:6379' });

    expect(redisCtor).toHaveBeenCalledWith('redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // The error listener is what keeps an ECONNREFUSED emit from killing the process.
    expect(mockRedis.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('namespaces every key with the prefix', async () => {
    const cache = createRedisTextCache({ url: 'redis://x', keyPrefix: 'research:' });
    mockRedis.get.mockResolvedValue('cached');

    await expect(cache.get('offers:1')).resolves.toBe('cached');
    await cache.set('offers:1', '[]', 60);
    await cache.del('offers:1');
    await cache.incrementWindow('rl:giga:5', 2000);

    expect(mockRedis.get).toHaveBeenCalledWith('research:offers:1');
    expect(mockRedis.set).toHaveBeenCalledWith('research:offers:1', '[]', 'EX', 60);
    expect(mockRedis.del).toHaveBeenCalledWith('research:offers:1');
    expect(mockRedis.incr).toHaveBeenCalledWith('research:rl:giga:5');
  });

  it('reads an outage as a miss and reports it, never throwing', async () => {
    const failures: string[] = [];
    const cache = createRedisTextCache({
      url: 'redis://x',
      onError: (operation) => {
        failures.push(operation);
      },
    });
    mockRedis.get.mockRejectedValue(new Error('connection lost'));
    mockRedis.set.mockRejectedValue(new Error('connection lost'));
    // `del` swallowing its outage is load-bearing: the entitlement engine's
    // `invalidate()` does not catch, so a throwing delete would fail the very
    // write path (plan change, config PATCH, payment webhook) it runs after.
    mockRedis.del.mockRejectedValue(new Error('connection lost'));

    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', 'v', 60)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBeUndefined();
    expect(failures).toEqual(['get', 'set', 'del']);
  });

  it('stamps the window expiry on the first increment only', async () => {
    const cache = createRedisTextCache({ url: 'redis://x' });

    mockRedis.incr.mockResolvedValueOnce(1);
    await expect(cache.incrementWindow('rl:w', 1000)).resolves.toBe(1);
    expect(mockRedis.pexpire).toHaveBeenCalledTimes(1);
    expect(mockRedis.pexpire).toHaveBeenCalledWith('rl:w', 1000);

    mockRedis.incr.mockResolvedValueOnce(2);
    await expect(cache.incrementWindow('rl:w', 1000)).resolves.toBe(2);
    expect(mockRedis.pexpire).toHaveBeenCalledTimes(1);
  });

  it('a counter outage answers null so the caller can fail open', async () => {
    const cache = createRedisTextCache({ url: 'redis://x' });
    mockRedis.incr.mockRejectedValue(new Error('READONLY'));

    await expect(cache.incrementWindow('rl:w', 1000)).resolves.toBeNull();
  });
});

describe('createRedisTextCache before the client is ready (FUT-2212)', () => {
  beforeEach(() => {
    // A fresh container: the socket is still connecting when the first request
    // arrives, and every command ioredis is handed now is refused.
    setClientStatus('connecting');
    mockRedis.get.mockImplementation(rejectUnlessReady('cached'));
    mockRedis.set.mockImplementation(rejectUnlessReady('OK'));
    mockRedis.del.mockImplementation(rejectUnlessReady(1));
    mockRedis.incr.mockImplementation(rejectUnlessReady(1));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the cache silently: the degraded value, and nothing reported', async () => {
    const failures: string[] = [];
    const cache = createRedisTextCache({
      url: 'redis://x',
      onError: (operation, error) => failures.push(`${operation}: ${String(error)}`),
    });

    await expect(cache.get('k')).resolves.toBeNull();
    await expect(cache.set('k', 'v', 60)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBeUndefined();
    await expect(cache.incrementWindow('w', 1000)).resolves.toBeNull();

    expect(failures).toEqual([]);
    // Skipped, not attempted: nothing was handed to a client that would refuse it.
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });

  it('serves normally once the client is ready', async () => {
    const cache = createRedisTextCache({ url: 'redis://x' });
    becomeReady();

    await expect(cache.get('k')).resolves.toBe('cached');
    await expect(cache.incrementWindow('w', 1000)).resolves.toBe(1);
  });

  it('whenReady waits for the handshake, so a fail-closed caller is not refused', async () => {
    const failures: string[] = [];
    const cache = createRedisTextCache({ url: 'redis://x', onError: (operation) => failures.push(operation) });
    const baseline = mockRedis.emitter.listenerCount('ready');

    const ready = cache.whenReady(2_000);
    const settled = vi.fn();
    void ready.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    becomeReady();

    await expect(ready).resolves.toBe(true);
    await expect(cache.incrementWindow('jti', 90_000)).resolves.toBe(1);
    expect(failures).toEqual([]);
    // No listener left behind on the client once the wait is settled.
    expect(mockRedis.emitter.listenerCount('ready')).toBe(baseline);
    expect(mockRedis.emitter.listenerCount('end')).toBe(0);
  });

  it('whenReady answers at once when the client is already ready', async () => {
    setClientStatus('ready');
    const cache = createRedisTextCache({ url: 'redis://x' });

    await expect(cache.whenReady(2_000)).resolves.toBe(true);
    expect(mockRedis.once).not.toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('a never-ready client times out within the bound and the caller still fails closed', async () => {
    vi.useFakeTimers();
    const cache = createRedisTextCache({ url: 'redis://x' });
    const baseline = mockRedis.emitter.listenerCount('ready');

    const ready = cache.whenReady(500);
    const settled = vi.fn();
    void ready.then(settled);
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(ready).resolves.toBe(false);
    await expect(cache.incrementWindow('jti', 90_000)).resolves.toBeNull();
    expect(mockRedis.emitter.listenerCount('ready')).toBe(baseline);
    expect(mockRedis.emitter.listenerCount('end')).toBe(0);
  });

  it('whenReady gives up at once on a client that has closed for good', async () => {
    const cache = createRedisTextCache({ url: 'redis://x' });

    const ready = cache.whenReady(60_000);
    closeForGood();

    await expect(ready).resolves.toBe(false);
  });

  it('a Redis that stays down is still reported, once per interval and not per command', async () => {
    vi.useFakeTimers();
    const failures: string[] = [];
    const cache = createRedisTextCache({
      url: 'redis://x',
      unavailableReportIntervalMs: 60_000,
      onError: (operation, error) => failures.push(`${operation}: ${String(error)}`),
    });

    // The connection attempt fails: that error is the client's own and is
    // reported as it always was.
    failToConnect();
    expect(failures).toEqual(['connection: Error: connect ECONNREFUSED 127.0.0.1:6379']);

    // Past the first connect, a skipped command is an outage: reported, but once.
    for (let i = 0; i < 5; i += 1) await expect(cache.get('k')).resolves.toBeNull();
    expect(failures).toHaveLength(2);
    expect(failures[1]).toMatch(/^get: Error: redis is not ready \(status: reconnecting\)/);

    await vi.advanceTimersByTimeAsync(60_000);
    await cache.incrementWindow('w', 1000);
    expect(failures).toHaveLength(3);
    expect(failures[2]).toMatch(/^incrementWindow: /);
  });
});
