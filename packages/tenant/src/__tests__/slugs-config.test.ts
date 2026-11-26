import { describe, expect, expectTypeOf, it } from 'vitest';

import { TENANT_PORT_METHODS, TenantConfigError } from '../index';
import { createApiTenant } from '../server';
import {
  TENANT_SLUG_PORT_METHODS,
  createKeptMemory,
  type KeptMemory,
  type TenantSlugPort,
  type TenantSlugs,
} from '../slugs';
import { serverConfig, withValue } from './fixtures';

/**
 * Slug resolution is OPT-IN: a host written against 1.x passes no `slugs`,
 * boots unchanged, and gets no `tenant.slugs`. A host that passes it must pass
 * the slug port's two members and a kept memory, checked at startup by name;
 * the memory's own options are checked when it is made, named `memory.<key>`.
 */

function errorOf(run: () => unknown): TenantConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof TenantConfigError) return error;
    throw error;
  }
  throw new Error('expected a TenantConfigError, nothing was thrown');
}

const api = (config: unknown) => () => createApiTenant(config as never);

const RECORD = { id: 't1', slug: 'north-wing' };

function slugPort(): TenantSlugPort {
  return { current: async (slug) => (slug === RECORD.slug ? RECORD : null), former: async () => null };
}

function memoryOptions(): Record<string, unknown> {
  return {
    channel: 'tenant_slug_changed',
    listen: async () => ({}),
    onError: () => undefined,
    backstopMs: 60_000,
    retryMs: 1_000,
    maxScopes: 100,
    maxSlots: 8,
  };
}

const memory = (): KeptMemory => createKeptMemory(memoryOptions() as never);

describe('a host with no slug resolution', () => {
  it('boots on the tenant port alone, and has no tenant.slugs', () => {
    const tenant = createApiTenant(serverConfig());
    expect(tenant.slugs).toBeUndefined();
    expect('slugs' in tenant).toBe(false);
  });

  it('adds nothing to the tenant port', () => {
    for (const method of TENANT_SLUG_PORT_METHODS) {
      expect(TENANT_PORT_METHODS as readonly string[]).not.toContain(method);
    }
  });
});

describe('a host with slug resolution', () => {
  it('gets tenant.slugs, resolving through the slug port it gave', async () => {
    const tenant = createApiTenant({ ...serverConfig(), slugs: { port: slugPort(), memory: memory() } });
    expect(await tenant.slugs?.resolve('north-wing')).toEqual(RECORD);
    expect(await tenant.slugs?.resolve('nowhere')).toBeNull();
  });

  it("hands back the host's own record type from tenant.slugs", async () => {
    interface Wing {
      id: string;
      slug: string;
      floor: number;
    }
    const wing: Wing = { ...RECORD, floor: 3 };
    const port: TenantSlugPort<Wing> = { current: async () => wing, former: async () => null };
    const tenant = createApiTenant({ ...serverConfig(), slugs: { port, memory: memory() } });
    const found = await tenant.slugs?.resolve('north-wing');
    expectTypeOf(found).toEqualTypeOf<Wing | null | undefined>();
    expect(found?.floor).toBe(3);
    // A host with no slugs keeps the default record type.
    expectTypeOf(createApiTenant(serverConfig()).slugs).toEqualTypeOf<TenantSlugs | undefined>();
  });

  it.each(TENANT_SLUG_PORT_METHODS)('refuses a slug port with no %s, by name', (method) => {
    const config = withValue({ ...serverConfig(), slugs: { port: slugPort(), memory: memory() } }, ['slugs', 'port', method], undefined);
    const error = errorOf(api(config));
    expect(error.key).toBe(`slugs.port.${method}`);
    expect(error.message).toMatch(/required and missing/u);
  });

  it.each(TENANT_SLUG_PORT_METHODS)('refuses a slug port whose %s is not a function', (method) => {
    const config = { ...serverConfig(), slugs: { port: { ...slugPort(), [method]: 'nope' }, memory: memory() } };
    expect(errorOf(api(config)).key).toBe(`slugs.port.${method}`);
  });

  it('refuses a missing port or memory, and a memory with no read', () => {
    expect(errorOf(api({ ...serverConfig(), slugs: { memory: memory() } })).key).toBe('slugs.port');
    expect(errorOf(api({ ...serverConfig(), slugs: { port: slugPort() } })).key).toBe('slugs.memory');
    expect(errorOf(api({ ...serverConfig(), slugs: { port: slugPort(), memory: {} } })).key).toBe('slugs.memory.read');
  });

  it.each([null, 'slugs', 42])('refuses %j as the slug config', (value) => {
    expect(errorOf(api({ ...serverConfig(), slugs: value })).key).toBe('slugs');
  });
});

describe('the kept memory fails at startup, named', () => {
  it.each(['channel', 'listen', 'onError', 'backstopMs', 'retryMs', 'maxScopes', 'maxSlots'])(
    'when %s is missing',
    (key) => {
      const options = { ...memoryOptions(), [key]: undefined };
      const error = errorOf(() => createKeptMemory(options as never));
      expect(error.key).toBe(`memory.${key}`);
      expect(error.message).toMatch(/required and missing/u);
    },
  );

  it.each([
    ['channel', 'Tenant-Slugs'],
    ['channel', 42],
    ['listen', 'nope'],
    ['onError', {}],
    ['backstopMs', 0],
    ['retryMs', -1],
    ['maxScopes', 1.5],
    ['maxSlots', '8'],
    ['database', 'nope'],
  ])('when %s is %j', (key, value) => {
    const error = errorOf(() => createKeptMemory({ ...memoryOptions(), [key]: value } as never));
    expect(error.key).toBe(`memory.${key}`);
  });

  it('when there are no options at all', () => {
    expect(errorOf(() => createKeptMemory(undefined as never)).key).toBe('memory');
  });
});
