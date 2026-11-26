import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EVERY_SCOPE,
  createKeptMemory,
  type KeptMemoryOptions,
  type TenantChangeHandlers,
  type TenantChangeListener,
} from '../slugs';

/**
 * The memory kept by notification: kept after the first load, one load for a
 * burst, dropped by a notification (one scope, or `*` for all) and by a
 * reconnect, never kept while nothing listens or when a notification overtook
 * the load, bounded by a backstop and the host's slot and scope bounds, a
 * failed listener retried only after the host's pause, and dropped whole when
 * the database it listens on changes. The listener is the host's: here a fake.
 */

const NOON = new Date('2026-10-29T12:00:00.000Z');
const HOURS = { open: '11:00', close: '23:00' };
const LATE = { open: '11:00', close: '02:00' };
const DATABASE = { name: 'the one client' };

const listen = vi.fn<TenantChangeListener>(async () => ({ close: async () => undefined }));
const onError = vi.fn<KeptMemoryOptions['onError']>();

/** The handlers the memory gave its listener, as the database would call them. */
const handlers = (): Required<TenantChangeHandlers> =>
  listen.mock.lastCall?.[1] as Required<TenantChangeHandlers>;
/** A few turns of the event loop: long enough for a read to still be out. */
const ticks = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i += 1) await new Promise<void>((resolve) => queueMicrotask(resolve));
};

/** The next listener start, as the host's `listen` would behave. */
function nextListen(impl: TenantChangeListener): void {
  listen.mockImplementationOnce(impl);
}

/** The next listener start fails. */
function nextListenRefused(error: Error): void {
  listen.mockRejectedValueOnce(error);
}

function setup(overrides: Partial<KeptMemoryOptions> = {}) {
  const database = vi.fn((): object | null => DATABASE);
  const made = createKeptMemory({
    channel: 'clinic_config_changed',
    listen,
    onError,
    backstopMs: 10 * 60 * 1000,
    retryMs: 30 * 1000,
    maxScopes: 5_000,
    maxSlots: 256,
    database,
    ...overrides,
  });
  return Object.assign(made, { listened: database });
}

beforeEach(() => {
  vi.useRealTimers();
  listen.mockClear();
  onError.mockClear();
});

describe('a value kept until the database says it changed', () => {
  it('loads once, then answers from memory, listening on the channel it was given', async () => {
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen.mock.lastCall?.[0]).toBe('clinic_config_changed');
  });

  it('peeks at what is kept, and never loads or listens for it', async () => {
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    expect(memory.peek('north-wing', 'hours')).toBeUndefined();
    expect(listen).not.toHaveBeenCalled();
    await memory.read('north-wing', 'hours', load);
    expect(memory.peek('north-wing', 'hours')).toEqual(HOURS);
    expect(memory.peek('north-wing', 'other-slot')).toBeUndefined();
    expect(memory.peek('south-wing', 'hours')).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('peeks nothing once a notification dropped the scope, or the listener went down', async () => {
    const memory = setup();
    await memory.read('north-wing', 'hours', async () => HOURS);
    handlers().onNotify('north-wing');
    expect(memory.peek('north-wing', 'hours')).toBeUndefined();
    await memory.read('north-wing', 'hours', async () => LATE);
    expect(memory.peek('north-wing', 'hours')).toEqual(LATE);
    handlers().onDisconnected();
    expect(memory.peek('north-wing', 'hours')).toBeUndefined();
  });

  it('asks once for two reads side by side', async () => {
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    await Promise.all([memory.read('north-wing', 'hours', load), memory.read('north-wing', 'hours', load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not make a read through a transaction wait on a load through the client', async () => {
    const memory = setup();
    const tx = { name: "the caller's transaction" };
    const throughClient = vi.fn(async () => {
      await ticks(20);
      return HOURS;
    });
    const throughTx = vi.fn(async () => LATE);
    const first = memory.read('north-wing', 'hours', throughClient);
    await ticks(5);
    expect(await memory.read('north-wing', 'hours', throughTx, { via: tx })).toEqual(LATE);
    expect(throughTx).toHaveBeenCalledTimes(1);
    expect(await first).toEqual(HOURS);
  });

  it('does not start the listener from a read through a transaction', async () => {
    const memory = setup();
    const tx = { name: "the caller's transaction" };
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load, { via: tx });
    await memory.read('north-wing', 'hours', load, { via: tx });
    expect(listen).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load, { via: tx });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('drops every slot of the scope a notification names, and no other scope', async () => {
    const memory = setup();
    const hours = vi.fn(async () => HOURS);
    const fees = vi.fn(async () => ['SERVICE']);
    const other = vi.fn(async () => LATE);
    await memory.read('north-wing', 'hours', hours);
    await memory.read('north-wing', 'fees', fees);
    await memory.read('south-wing', 'hours', other);
    handlers().onNotify('north-wing');
    await memory.read('north-wing', 'hours', hours);
    await memory.read('north-wing', 'fees', fees);
    await memory.read('south-wing', 'hours', other);
    expect(hours).toHaveBeenCalledTimes(2);
    expect(fees).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('drops every scope on `*`', async () => {
    const memory = setup();
    const one = vi.fn(async () => HOURS);
    const two = vi.fn(async () => LATE);
    await memory.read('north-wing', 'hours', one);
    await memory.read('south-wing', 'hours', two);
    handlers().onNotify(EVERY_SCOPE);
    await memory.read('north-wing', 'hours', one);
    await memory.read('south-wing', 'hours', two);
    expect(one).toHaveBeenCalledTimes(2);
    expect(two).toHaveBeenCalledTimes(2);
  });

  it('drops everything when the listener reconnects', async () => {
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    handlers().onConnected();
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops everything when the listener disconnects, and keeps nothing until it reconnects', async () => {
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    handlers().onDisconnected();
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(3);
    handlers().onConnected();
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('stays down when the listener dropped before its start resolved', async () => {
    const gate: { up?: () => void } = {};
    nextListen(
      (_channel, given) =>
        new Promise((resolve) => {
          gate.up = () => {
            given.onDisconnected?.();
            resolve({});
          };
        }),
    );
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    const first = memory.read('north-wing', 'hours', load);
    await ticks(2);
    gate.up?.();
    await first;
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(2);
    handlers().onConnected();
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('reports a drop to the host, naming the channel', async () => {
    const memory = setup();
    await memory.read('north-wing', 'hours', async () => HOURS);
    const error = new Error('connection reset');
    handlers().onError(error);
    expect(onError).toHaveBeenCalledWith({ phase: 'dropped', channel: 'clinic_config_changed', error });
  });

  it('quiets only the scope it is told, when it is told one', async () => {
    const memory = setup();
    const mine = vi.fn(async () => HOURS);
    const other = vi.fn(async () => LATE);
    await memory.read('north-wing', 'hours', mine);
    await memory.read('south-wing', 'hours', other);
    memory.quiet(2_000, 'north-wing');
    await memory.read('north-wing', 'hours', mine);
    await memory.read('north-wing', 'hours', mine);
    await memory.read('south-wing', 'hours', other);
    expect(mine).toHaveBeenCalledTimes(3);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing while it cannot listen, and tells the host why', async () => {
    const memory = setup();
    const error = new Error('listen refused');
    nextListenRefused(error);
    const load = vi.fn(async () => HOURS);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith({ phase: 'start', channel: 'clinic_config_changed', error });
  });

  it('stays usable when the host reporter throws on a failed start, and retries after retryMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOON });
    const memory = setup({
      retryMs: 5_000,
      onError: () => {
        throw new Error('the logger is down');
      },
    });
    nextListenRefused(new Error('listen refused'));
    const load = vi.fn(async () => HOURS);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(listen).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-29T12:00:05.001Z'));
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(listen).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('swallows a host reporter that throws on a dropped listener', async () => {
    const memory = setup({
      onError: () => {
        throw new Error('the logger is down');
      },
    });
    await memory.read('north-wing', 'hours', async () => HOURS);
    expect(() => handlers().onError(new Error('connection reset'))).not.toThrow();
    const load = vi.fn(async () => LATE);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
  });

  it('keeps nothing when the listener throws instead of rejecting', async () => {
    const memory = setup();
    nextListen(() => {
      throw new Error('no listener here');
    });
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not keep a load that a notification overtook', async () => {
    const memory = setup();
    const overtaken = vi.fn(async () => {
      handlers().onNotify('north-wing');
      return HOURS;
    });
    expect(await memory.read('north-wing', 'hours', overtaken)).toEqual(HOURS);
    const load = vi.fn(async () => LATE);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(LATE);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps a load that a notification for ANOTHER scope overtook', async () => {
    const memory = setup();
    const overtaken = vi.fn(async () => {
      handlers().onNotify('south-wing');
      return HOURS;
    });
    await memory.read('north-wing', 'hours', overtaken);
    const load = vi.fn(async () => LATE);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(HOURS);
    expect(load).not.toHaveBeenCalled();
  });

  it('does not hand a read that started before a notification to one that starts after it', async () => {
    const memory = setup();
    const older = vi.fn(async () => {
      await ticks(20);
      return HOURS;
    });
    const fresh = vi.fn(async () => LATE);
    const first = memory.read('north-wing', 'hours', older);
    await ticks(5);
    handlers().onNotify('north-wing');
    expect(await memory.read('north-wing', 'hours', fresh)).toEqual(LATE);
    expect(await first).toEqual(HOURS);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a snapshot read only when nothing at all was dropped since its epoch', async () => {
    const memory = setup();
    const since = memory.epoch();
    memory.drop('south-wing');
    await memory.read('north-wing', 'hours', async () => HOURS, { since });
    const load = vi.fn(async () => LATE);
    expect(await memory.read('north-wing', 'hours', load)).toEqual(LATE);
  });

  it('does not keep an answer its reader says not to', async () => {
    const memory = setup();
    const load = vi.fn(async () => null);
    const keep = (value: null): boolean => value !== null;
    expect(await memory.read('nobody', 'tenant', load, { keep })).toBeNull();
    expect(await memory.read('nobody', 'tenant', load, { keep })).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxSlots slots of one scope, the oldest dropped first', async () => {
    const memory = setup({ maxSlots: 3 });
    const first = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'first', first);
    for (let slot = 0; slot < 3; slot += 1) await memory.read('north-wing', `slot-${slot}`, async () => slot);
    const latest = vi.fn(async () => 2);
    expect(await memory.read('north-wing', 'slot-2', latest)).toBe(2);
    expect(latest).not.toHaveBeenCalled();
    await memory.read('north-wing', 'first', first);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxScopes scopes, the least recently kept dropped first', async () => {
    const memory = setup({ maxScopes: 2 });
    const oldest = vi.fn(async () => HOURS);
    await memory.read('a', 'hours', oldest);
    await memory.read('b', 'hours', async () => HOURS);
    await memory.read('c', 'hours', async () => HOURS);
    await memory.read('a', 'hours', oldest);
    expect(oldest).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing while quieted, and keeps again after', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOON });
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    memory.quiet(2_000);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(3);
    vi.setSystemTime(new Date('2026-10-29T12:00:02.001Z'));
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('loads again once the backstop lifetime the host set is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOON });
    const memory = setup({ backstopMs: 60_000 });
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    vi.setSystemTime(new Date('2026-10-29T12:00:59.999Z'));
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-29T12:01:00.001Z'));
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('tries a listener that failed to start again only after the pause the host set', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOON });
    const memory = setup({ retryMs: 5_000 });
    nextListenRefused(new Error('listen refused'));
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(listen).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-29T12:00:05.001Z'));
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(listen).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('drops everything and listens afresh when the database changes', async () => {
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    memory.listened.mockReturnValueOnce({ name: 'a database a test swapped in' });
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(listen).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing when there is no database to bind to', async () => {
    const memory = setup();
    memory.listened.mockImplementation(() => {
      throw new Error('no client in this test');
    });
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(listen).not.toHaveBeenCalled();
  });

  it('compares nothing when the host gives no database', async () => {
    const memory = setup({ database: undefined });
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('counts a listener that resolved as connected, without onConnected', async () => {
    nextListen(async () => ({}));
    const memory = setup();
    const load = vi.fn(async () => HOURS);
    await memory.read('north-wing', 'hours', load);
    await memory.read('north-wing', 'hours', load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
