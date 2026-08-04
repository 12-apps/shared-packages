import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Redis text cache's contract is its FAILURE shape (FUT-416): a consumer
 * binds it as a best-effort cache/limiter backend, so an outage must read as a
 * miss / a no-op / "fail open" — never as a thrown error. ioredis is mocked;
 * what is pinned is what each operation does with the client and with the
 * client's failures.
 */

const { mockRedis, redisCtor } = vi.hoisted(() => {
  const mockRedis = {
    on: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
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
