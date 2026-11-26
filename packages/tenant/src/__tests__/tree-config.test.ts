import { describe, expect, it } from 'vitest';

import { TenantConfigError } from '../index';
import { TENANT_PORT_METHODS, TENANT_TREE_PORT_METHODS, type TenantTreePort } from '../port';
import { createApiTenant } from '../server';
import { serverConfig, withValue, type FakeTx } from './fixtures';

/**
 * The tenant tree is OPT-IN: a host with no tree (every host written against a
 * release before it) passes no `tree`, boots, and gets no `tenant.tree`. A host
 * that passes one must pass all four members, checked at startup by name.
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

function treePort(): TenantTreePort<FakeTx> {
  return {
    treeNode: async (id) => ({ id, parentId: null, path: `/${id}/` }),
    treeAncestors: async () => [],
    treeDescendants: async () => [],
    moveSubtree: async () => 0,
  };
}

describe('a host with no tree', () => {
  it('boots on the five-method tenant port alone, and has no tenant.tree', () => {
    const config = serverConfig();
    expect(Object.keys(config.port).sort()).toEqual([...TENANT_PORT_METHODS].sort());
    const tenant = createApiTenant(config);
    expect(tenant.tree).toBeUndefined();
    expect('tree' in tenant).toBe(false);
  });

  it('does not need the tree members on its tenant port', () => {
    for (const method of TENANT_TREE_PORT_METHODS) {
      expect(TENANT_PORT_METHODS as readonly string[]).not.toContain(method);
    }
  });
});

describe('a host with a tree', () => {
  it('gets tenant.tree, reading through the tree port it gave', async () => {
    const tenant = createApiTenant({ ...serverConfig(), tree: treePort() });
    expect(tenant.tree).toBeDefined();
    expect(await tenant.tree?.rootOf('solo')).toBe('solo');
  });

  it.each(TENANT_TREE_PORT_METHODS)('refuses a tree port with no %s, by name', (method) => {
    const config = withValue({ ...serverConfig(), tree: treePort() }, ['tree', method], undefined);
    const error = errorOf(api(config));
    expect(error.key).toBe(`tree.${method}`);
    expect(error.message).toMatch(/required and missing/u);
  });

  it.each(TENANT_TREE_PORT_METHODS)('refuses a tree port whose %s is not a function', (method) => {
    const config = withValue({ ...serverConfig(), tree: treePort() }, ['tree', method], 'nope');
    expect(errorOf(api(config)).key).toBe(`tree.${method}`);
  });

  it.each([null, 'tree', 42])('refuses %j as the tree port', (value) => {
    expect(errorOf(api({ ...serverConfig(), tree: value })).key).toBe('tree');
  });
});
