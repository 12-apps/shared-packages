import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeResourceIds, type RbacSubjectGrants } from '../grants';
import {
  RBAC_CHANGED_EVERYONE,
  createKeptGrants,
  type KeptGrantsOptions,
  type RbacChangeHandlers,
} from '../kept-grants';

/**
 * The in-memory store over a person's grants (FUT-3906, moved into the package
 * by FUT-3985): kept after the first question, dropped by the notification a
 * trigger sends, and never trusted past its backstop or a grant's window.
 */

const NOON_ISO = '2026-10-29T12:00:00.000Z';
const noon = (): Date => new Date(NOON_ISO);
const MINUTE = 60 * 1000;

const grantsFor = (role: string, extra: Partial<RbacSubjectGrants> = {}): RbacSubjectGrants => ({
  assignments: [{ role, scope: 'tenant-a' }],
  resources: [],
  memberships: [{ clientId: 'tenant-a', role, active: true }],
  ...extra,
});

interface Harness {
  store: ReturnType<typeof createKeptGrants>;
  loads: () => number;
  handlers: () => RbacChangeHandlers;
  setRole: (role: string) => void;
  errors: string[];
}

function harness(overrides: Partial<KeptGrantsOptions> = {}): Harness {
  const state = { role: 'OWNER', loads: 0, handlers: null as RbacChangeHandlers | null };
  const errors: string[] = [];
  const store = createKeptGrants({
    load: async () => {
      state.loads += 1;
      return grantsFor(state.role);
    },
    listen: async (_channel, handlers) => {
      state.handlers = handlers;
    },
    onError: (message) => errors.push(message),
    ...overrides,
  });
  return {
    store,
    loads: () => state.loads,
    handlers: () => {
      if (!state.handlers) throw new Error('the listener never started');
      return state.handlers;
    },
    setRole: (role) => {
      state.role = role;
    },
    errors,
  };
}

/** A store whose FIRST load waits until released, so a notification can overtake it. */
function gatedHarness() {
  const gate: { open: (() => void) | null; loads: number; handlers: RbacChangeHandlers | null } = {
    open: null,
    loads: 0,
    handlers: null,
  };
  const store = createKeptGrants({
    load: async () => {
      gate.loads += 1;
      if (gate.loads === 1) await new Promise<void>((resolve) => (gate.open = resolve));
      return grantsFor(gate.loads === 1 ? 'OWNER' : 'WAITER');
    },
    listen: async (_channel, handlers) => {
      gate.handlers = handlers;
    },
  });
  return {
    store,
    loading: () => gate.open !== null,
    release: () => gate.open?.(),
    loads: () => gate.loads,
    handlers: () => {
      if (!gate.handlers) throw new Error('the listener never started');
      return gate.handlers;
    },
  };
}

/** A store whose one person holds a mesa until `endsAt`. */
function windowedHarness(endsAt: string) {
  const counted = { loads: 0 };
  const store = createKeptGrants({
    load: async () => {
      counted.loads += 1;
      return grantsFor('WAITER', {
        resources: [
          { resourceType: 'tables', resourceId: 'mesa-1', clientId: 'tenant-a', validFrom: NOON_ISO, validTo: endsAt },
        ],
      });
    },
    listen: async () => undefined,
  });
  return { store, loads: () => counted.loads };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(noon());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a person kept', () => {
  it('loads once, then answers every later question from memory', async () => {
    const host = harness();
    await host.store.grantsOf('ana');
    await host.store.get('ana', async () => grantsFor('IGNORED'));
    expect(await host.store.membershipRole('ana', 'tenant-a')).toBe('OWNER');
    expect(host.loads()).toBe(1);
  });

  it('shares one load between questions asked side by side', async () => {
    const host = harness();
    await Promise.all([host.store.grantsOf('ana'), host.store.grantsOf('ana'), host.store.grantsOf('ana')]);
    expect(host.loads()).toBe(1);
  });

  it('answers no membership role for a tenant the person is not a member of', async () => {
    const host = harness();
    expect(await host.store.membershipRole('ana', 'tenant-b')).toBeNull();
  });
});

describe('a notification', () => {
  it('drops only the person it names', async () => {
    const host = harness();
    await host.store.grantsOf('ana');
    await host.store.grantsOf('bia');
    host.setRole('WAITER');
    host.handlers().onNotify('ana');
    expect((await host.store.grantsOf('ana')).assignments[0]?.role).toBe('WAITER');
    expect((await host.store.grantsOf('bia')).assignments[0]?.role).toBe('OWNER');
    expect(host.loads()).toBe(3);
  });

  it('drops everyone on the `*` payload', async () => {
    const host = harness();
    await host.store.grantsOf('ana');
    await host.store.grantsOf('bia');
    host.handlers().onNotify(RBAC_CHANGED_EVERYONE);
    await host.store.grantsOf('ana');
    await host.store.grantsOf('bia');
    expect(host.loads()).toBe(4);
  });

  it('drops everyone when the listener reconnects, since one may have been lost', async () => {
    const host = harness();
    await host.store.grantsOf('ana');
    host.handlers().onConnected();
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(2);
  });

  it('keeps nothing a notification overtook while it loaded', async () => {
    const gated = gatedHarness();
    const first = gated.store.grantsOf('ana');
    await vi.waitFor(() => expect(gated.loading()).toBe(true));
    gated.handlers().onNotify('ana');
    gated.release();
    expect((await first).assignments[0]?.role).toBe('OWNER');
    expect((await gated.store.grantsOf('ana')).assignments[0]?.role).toBe('WAITER');
    expect(gated.loads()).toBe(2);
  });
});

describe('a listener that dropped', () => {
  it('keeps nothing from the drop until it reconnects', async () => {
    const host = harness();
    await host.store.grantsOf('ana');
    host.handlers().onError(new Error('connection reset'));
    await host.store.grantsOf('ana');
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(3);
    expect(host.errors.join('\n')).toContain('connection reset');

    host.handlers().onConnected();
    await host.store.grantsOf('ana');
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(4);
  });
});

describe('without a listener', () => {
  it('keeps nothing, and asks the database again only after the retry wait', async () => {
    const attempts = { count: 0 };
    const host = harness({
      listen: async () => {
        attempts.count += 1;
        throw new Error('LISTEN refused');
      },
      retryMs: 30_000,
    });
    await host.store.grantsOf('ana');
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(2);
    expect(attempts.count).toBe(1);
    expect(host.errors.join('\n')).toContain('LISTEN refused');

    vi.advanceTimersByTime(30_001);
    await host.store.grantsOf('ana');
    expect(attempts.count).toBe(2);
  });

  it('treats a listener that throws synchronously as one that failed to start', async () => {
    const host = harness({
      listen: () => {
        throw new Error('no connection string');
      },
    });
    await host.store.grantsOf('ana');
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(2);
  });
});

describe('the lifetime of a kept copy', () => {
  it('ends at the backstop when no notification ever arrives', async () => {
    const host = harness({ backstopMs: 10 * MINUTE });
    await host.store.grantsOf('ana');
    vi.advanceTimersByTime(10 * MINUTE - 1);
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(1);
    vi.advanceTimersByTime(2);
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(2);
  });

  it('ends when a grant window closes, and the closed grant is never honoured', async () => {
    const endsAt = new Date(noon().getTime() + MINUTE).toISOString();
    const windowed = windowedHarness(endsAt);
    const before = await windowed.store.grantsOf('ana');
    expect(activeResourceIds(before, 'tables', { clientId: 'tenant-a' }, noon())).toEqual(['mesa-1']);
    vi.advanceTimersByTime(MINUTE);
    const after = await windowed.store.grantsOf('ana');
    expect(activeResourceIds(after, 'tables', { clientId: 'tenant-a' }, new Date(endsAt))).toEqual([]);
    expect(windowed.loads()).toBe(2);
  });

  it('drops the oldest person past the bound', async () => {
    const host = harness({ maxKept: 2 });
    await host.store.grantsOf('ana');
    await host.store.grantsOf('bia');
    await host.store.grantsOf('caio');
    await host.store.grantsOf('bia');
    expect(host.loads()).toBe(3);
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(4);
  });

  it('starts from nothing after a reset', async () => {
    const host = harness();
    await host.store.grantsOf('ana');
    host.store.reset();
    await host.store.grantsOf('ana');
    expect(host.loads()).toBe(2);
  });
});
