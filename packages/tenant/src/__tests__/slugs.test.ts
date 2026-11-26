import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createKeptMemory,
  createKeptSlugs,
  createSlugResolver,
  createTenantSlugs,
  type KeptMemory,
  type TenantChangeHandlers,
  type TenantChangeListener,
  type TenantSlugParent,
  type TenantSlugPort,
} from '../slugs';
import { TenantTreeError } from '../tree';

/**
 * Slug resolution: the current slug first and a kept (former) one only on a
 * miss, one read each; a root keyed on its slug alone, a unit on its parent's
 * path plus the slug; only a found tenant kept; a slug holding `/` loaded and
 * never kept or thrown on.
 */

interface Clinic {
  id: string;
  slug: string;
  name: string;
}

const NORTH: Clinic = { id: 't1', slug: 'north-wing', name: 'North wing' };
const UNIT: Clinic = { id: 'u1', slug: 'radiology', name: 'Radiology' };

const listen = vi.fn<TenantChangeListener>(async () => ({}));
const handlers = (): TenantChangeHandlers => listen.mock.lastCall?.[1] as TenantChangeHandlers;

function memory(): KeptMemory {
  return createKeptMemory({
    channel: 'tenant_slug_changed',
    listen,
    onError: () => undefined,
    backstopMs: 60_000,
    retryMs: 1_000,
    maxScopes: 100,
    maxSlots: 4,
  });
}

/** A port over two tables: current slugs, and slugs held before, each keyed by parent path ('' for roots). */
function port() {
  const current = new Map<string, Clinic>([
    [NORTH.slug, NORTH],
    [`/t1/${UNIT.slug}`, UNIT],
  ]);
  const former = new Map<string, Clinic>([['old-north', NORTH]]);
  const at = (slug: string, parent: TenantSlugParent | null) => `${parent?.path.slice(0, -1) ?? ''}${parent ? '/' : ''}${slug}`;
  return {
    current: vi.fn<TenantSlugPort<Clinic>['current']>(async (slug, parent) => current.get(at(slug, parent)) ?? null),
    former: vi.fn<TenantSlugPort<Clinic>['former']>(async (slug, parent) => former.get(at(slug, parent)) ?? null),
  };
}

beforeEach(() => {
  listen.mockClear();
});

describe('the resolver', () => {
  it('reads the current slug once, and never a former one when it is found', async () => {
    const slugs = port();
    expect(await createSlugResolver(slugs).load('north-wing')).toEqual(NORTH);
    expect(slugs.current).toHaveBeenCalledTimes(1);
    expect(slugs.current).toHaveBeenCalledWith('north-wing', null);
    expect(slugs.former).not.toHaveBeenCalled();
  });

  it('reads a former slug only on a miss, answering the tenant with its CURRENT slug', async () => {
    const slugs = port();
    expect(await createSlugResolver(slugs).load('old-north')).toEqual(NORTH);
    expect(slugs.current).toHaveBeenCalledTimes(1);
    expect(slugs.former).toHaveBeenCalledTimes(1);
  });

  it('answers null for an unknown slug after two reads', async () => {
    const slugs = port();
    expect(await createSlugResolver(slugs).load('nowhere')).toBeNull();
    expect(slugs.current).toHaveBeenCalledTimes(1);
    expect(slugs.former).toHaveBeenCalledTimes(1);
  });

  it('hands the port the parent a lookup names: its id and its path', async () => {
    const slugs = port();
    expect(await createSlugResolver(slugs).load('radiology', { parentPath: '/t1/' })).toEqual(UNIT);
    expect(slugs.current).toHaveBeenCalledWith('radiology', { id: 't1', path: '/t1/' });
    expect(await createSlugResolver(slugs).load('radiology')).toBeNull();
  });

  it('refuses a parent path that is not a tree path', async () => {
    const slugs = port();
    await expect(createSlugResolver(slugs).load('radiology', { parentPath: 't1' })).rejects.toBeInstanceOf(
      TenantTreeError,
    );
    expect(slugs.current).not.toHaveBeenCalled();
  });
});

describe('the kept slugs', () => {
  it('keeps a found tenant: the second lookup reads nothing', async () => {
    const slugs = port();
    const tenant = createTenantSlugs({ port: slugs, memory: memory() });
    expect(await tenant.resolve('north-wing')).toEqual(NORTH);
    expect(await tenant.resolve('north-wing')).toEqual(NORTH);
    expect(slugs.current).toHaveBeenCalledTimes(1);
  });

  it('keeps a former slug under its own address', async () => {
    const slugs = port();
    const tenant = createTenantSlugs({ port: slugs, memory: memory() });
    await tenant.resolve('old-north');
    await tenant.resolve('old-north');
    expect(slugs.current).toHaveBeenCalledTimes(1);
    expect(slugs.former).toHaveBeenCalledTimes(1);
  });

  it('never keeps an unknown slug', async () => {
    const slugs = port();
    const tenant = createTenantSlugs({ port: slugs, memory: memory() });
    expect(await tenant.resolve('nowhere')).toBeNull();
    expect(await tenant.resolve('nowhere')).toBeNull();
    expect(slugs.current).toHaveBeenCalledTimes(2);
  });

  it('keys a unit on its parent path, apart from a root of the same slug', async () => {
    const kept = createKeptSlugs(memory());
    const root = vi.fn(async () => NORTH);
    const unit = vi.fn(async () => UNIT);
    expect(await kept.read('radiology', root)).toEqual(NORTH);
    expect(await kept.read('radiology', unit, { parentPath: '/t1/' })).toEqual(UNIT);
    expect(await kept.read('radiology', unit, { parentPath: '/t1/' })).toEqual(UNIT);
    expect(await kept.read('radiology', root)).toEqual(NORTH);
    expect(root).toHaveBeenCalledTimes(1);
    expect(unit).toHaveBeenCalledTimes(1);
  });

  it('keys a root on its slug alone, so a notification for every scope drops it', async () => {
    const kept = createKeptSlugs(memory());
    const load = vi.fn(async () => NORTH);
    await kept.read('north-wing', load);
    handlers().onNotify('north-wing');
    await kept.read('north-wing', load);
    expect(load).toHaveBeenCalledTimes(2);
    handlers().onNotify('*');
    await kept.read('north-wing', load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('loads a slug holding "/" every time, never keeping it nor throwing on it', async () => {
    const kept = createKeptSlugs(memory());
    const load = vi.fn(async () => null);
    expect(await kept.read('a/b', load)).toBeNull();
    expect(await kept.read('a/b', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(listen).not.toHaveBeenCalled();
  });

  it('refuses a bad parent path before it loads', async () => {
    const kept = createKeptSlugs(memory());
    const load = vi.fn(async () => UNIT);
    expect(() => kept.read('radiology', load, { parentPath: '/t1' })).toThrow(TenantTreeError);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps a host reading the port does not make, in the same memory', async () => {
    const tenant = createTenantSlugs({ port: port(), memory: memory() });
    const load = vi.fn(async () => ({ ...NORTH, zone: 'UTC' }));
    expect(await tenant.remember('north-wing', load)).toMatchObject({ zone: 'UTC' });
    expect(await tenant.remember('north-wing', load)).toMatchObject({ zone: 'UTC' });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
