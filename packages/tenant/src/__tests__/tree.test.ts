import { describe, expect, it } from 'vitest';

import type { TenantTreeMove, TenantTreeNode } from '../port';
import {
  TenantTreeError,
  childPath,
  createTenantTree,
  depthOf,
  isWithin,
  parsePath,
  rootPath,
  validateNode,
  type TenantTreePort,
} from '../tree';

/**
 * An in-memory host: it stores nodes and applies a move the way a host's ONE
 * statement does (every path under `fromPath` re-prefixed, the top
 * re-pointed), and it counts every port call, so "one port call" is asserted
 * rather than assumed.
 */
interface FakeTx {
  label: string;
}

/** The caller's transaction: every move must hand it to the port. */
const TX: FakeTx = { label: 'caller-tx' };

function memoryHost(nodes: TenantTreeNode[]) {
  const rows = new Map(nodes.map((node) => [node.id, { ...node }]));
  const calls: string[] = [];
  const moves: TenantTreeMove[] = [];
  const txs: Array<FakeTx | undefined> = [];
  const port: TenantTreePort<FakeTx> = {
    treeNode: async (id, tx) => {
      calls.push('treeNode');
      txs.push(tx);
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    treeAncestors: async (id) => {
      calls.push('treeAncestors');
      const row = rows.get(id);
      if (!row) return [];
      const ids = new Set(row.path.slice(1, -1).split('/'));
      return [...rows.values()].filter((node) => ids.has(node.id)).map((node) => ({ ...node }));
    },
    treeDescendants: async (id) => {
      calls.push('treeDescendants');
      const row = rows.get(id);
      if (!row) return [];
      return [...rows.values()].filter((node) => node.path.startsWith(row.path)).map((node) => ({ ...node }));
    },
    moveSubtree: async (move, tx) => {
      calls.push('moveSubtree');
      moves.push(move);
      txs.push(tx);
      const top = rows.get(move.id);
      const parent = move.parentId === null ? null : rows.get(move.parentId);
      if (!top || top.path !== move.fromPath) return 0;
      if (move.parentId !== null && parent?.path !== move.parentPath) return 0;
      let written = 0;
      for (const row of rows.values()) {
        if (!row.path.startsWith(move.fromPath)) continue;
        row.path = move.toPath + row.path.slice(move.fromPath.length);
        if (row.id === move.id) row.parentId = move.parentId;
        written += 1;
      }
      return written;
    },
  };
  return { port, rows, calls, moves, txs };
}

/** A chain ids[0] -> ids[1] -> …, each the parent of the next. */
function chainNodes(ids: readonly string[]): TenantTreeNode[] {
  return ids.map((id, index) => ({
    id,
    parentId: index === 0 ? null : (ids[index - 1] as string),
    path: `/${ids.slice(0, index + 1).join('/')}/`,
  }));
}

const DEEP = Array.from({ length: 12 }, (_, index) => `t${index}`);

async function refusal(work: Promise<unknown>): Promise<TenantTreeError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TenantTreeError);
  return error as TenantTreeError;
}

describe('the path', () => {
  it('is the ids from the root down to the tenant, each closed by a slash', () => {
    expect(rootPath('a')).toBe('/a/');
    expect(childPath('/a/', 'b')).toBe('/a/b/');
    expect(childPath(childPath('/a/', 'b'), 'c')).toBe('/a/b/c/');
    expect(parsePath('/a/b/c/')).toEqual(['a', 'b', 'c']);
    expect(depthOf('/a/')).toBe(0);
    expect(depthOf('/a/b/c/')).toBe(2);
  });

  it('places a tenant within its ancestors, and not within a tenant whose id merely starts like one', () => {
    expect(isWithin('/a/b/', '/a/')).toBe(true);
    expect(isWithin('/a/', '/a/')).toBe(true);
    expect(isWithin('/ab/', '/a/')).toBe(false);
    expect(isWithin('/a/', '/a/b/')).toBe(false);
  });

  it.each(['', '/', 'a/', '/a', '//', '/a//b/', 'a'])('refuses the malformed path %j', (path) => {
    expect(() => parsePath(path)).toThrow(TenantTreeError);
  });

  it('refuses a path that names a tenant twice: a cycle cannot be written down', () => {
    expect(() => parsePath('/a/b/a/')).toThrow(/twice/u);
  });

  it.each(['', 'a/b'])('refuses %j as a tenant id', (id) => {
    expect(() => rootPath(id)).toThrow(TenantTreeError);
  });

  it("holds a node to its own row: its path ends in it, and its parent is the segment before", () => {
    expect(validateNode({ id: 'b', parentId: 'a', path: '/a/b/' })).toEqual(['a', 'b']);
    expect(validateNode({ id: 'a', parentId: null, path: '/a/' })).toEqual(['a']);
    expect(() => validateNode({ id: 'b', parentId: null, path: '/a/b/' })).toThrow(TenantTreeError);
    expect(() => validateNode({ id: 'b', parentId: 'a', path: '/a/c/' })).toThrow(TenantTreeError);
    expect(() => validateNode({ id: 'a', parentId: 'x', path: '/a/' })).toThrow(TenantTreeError);
  });
});

describe('the reads, each ONE port call at any depth', () => {
  it('answers a standalone tenant as its own root, with nothing above or below it', async () => {
    const host = memoryHost([{ id: 'solo', parentId: null, path: '/solo/' }]);
    const tree = createTenantTree(host.port);
    expect(await tree.parentOf('solo')).toBeNull();
    expect(await tree.rootOf('solo')).toBe('solo');
    expect(await tree.ancestorsOf('solo')).toEqual([]);
    expect(await tree.descendantsOf('solo')).toEqual([]);
    expect(host.calls).toEqual(['treeNode', 'treeNode', 'treeAncestors', 'treeDescendants']);
  });

  it('reads the parent and the root of a tenant twelve levels deep with one call each', async () => {
    const host = memoryHost(chainNodes(DEEP));
    const tree = createTenantTree(host.port);
    expect(await tree.parentOf('t11')).toBe('t10');
    expect(await tree.rootOf('t11')).toBe('t0');
    expect(host.calls).toEqual(['treeNode', 'treeNode']);
  });

  it('reads every ancestor, nearest first, with one call', async () => {
    const host = memoryHost([...chainNodes(DEEP), { id: 'other', parentId: null, path: '/other/' }]);
    const tree = createTenantTree(host.port);
    const ancestors = await tree.ancestorsOf('t11');
    expect(ancestors.map((node) => node.id)).toEqual([...DEEP].slice(0, 11).reverse());
    expect(host.calls).toEqual(['treeAncestors']);
  });

  it('reads every descendant, shallowest first, the tenant itself excluded, with one call', async () => {
    const host = memoryHost([
      ...chainNodes(DEEP),
      { id: 'side', parentId: 't2', path: '/t0/t1/t2/side/' },
      { id: 'other', parentId: null, path: '/other/' },
    ]);
    const tree = createTenantTree(host.port);
    const below = await tree.descendantsOf('t2');
    expect(below.map((node) => node.id)).toEqual(['side', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11']);
    expect(host.calls).toEqual(['treeDescendants']);
  });

  it('refuses an unknown tenant by name, on every read', async () => {
    const tree = createTenantTree(memoryHost([]).port);
    for (const read of [tree.parentOf, tree.rootOf, tree.ancestorsOf, tree.descendantsOf]) {
      expect((await refusal(read('ghost'))).code).toBe('unknown-tenant');
    }
  });

  it('refuses a host read that disagrees with the tenant’s own path', async () => {
    const host = memoryHost(chainNodes(['a', 'b', 'c']));
    host.port.treeAncestors = async () => [
      { id: 'a', parentId: null, path: '/a/' },
      { id: 'c', parentId: 'b', path: '/a/b/c/' },
    ];
    host.port.treeDescendants = async () => [
      { id: 'b', parentId: 'a', path: '/a/b/' },
      { id: 'x', parentId: null, path: '/x/' },
    ];
    const tree = createTenantTree(host.port);
    expect((await refusal(tree.ancestorsOf('c'))).code).toBe('corrupt-path');
    expect((await refusal(tree.descendantsOf('b'))).code).toBe('corrupt-path');
  });
});

describe('a tenant cannot become its own ancestor', () => {
  it('refuses a tenant as its own parent, and writes nothing', async () => {
    const host = memoryHost(chainNodes(['a', 'b']));
    expect((await refusal(createTenantTree(host.port).move('a', 'a', TX))).code).toBe('cycle');
    expect(host.moves).toEqual([]);
  });

  it('refuses a move under any of its own descendants, at any depth, and writes nothing', async () => {
    const host = memoryHost(chainNodes(DEEP));
    const tree = createTenantTree(host.port);
    for (const below of ['t1', 't5', 't11']) {
      expect((await refusal(tree.move('t0', below, TX))).code).toBe('cycle');
    }
    expect(host.moves).toEqual([]);
    expect(host.rows.get('t0')?.path).toBe('/t0/');
  });
});

describe('a subtree move', () => {
  it('rewrites the whole subtree with ONE write, planned with both paths', async () => {
    const host = memoryHost([...chainNodes(['r', 'u', 'v', 'w']), { id: 's', parentId: null, path: '/s/' }]);
    const written = await createTenantTree(host.port).move('u', 's', TX);
    expect(written).toBe(3);
    expect(host.calls.filter((call) => call === 'moveSubtree')).toHaveLength(1);
    expect(host.moves).toEqual([{ id: 'u', parentId: 's', parentPath: '/s/', fromPath: '/r/u/', toPath: '/s/u/' }]);
    expect(host.rows.get('u')).toEqual({ id: 'u', parentId: 's', path: '/s/u/' });
    expect(host.rows.get('w')).toEqual({ id: 'w', parentId: 'v', path: '/s/u/v/w/' });
    expect(host.rows.get('r')).toEqual({ id: 'r', parentId: null, path: '/r/' });
    // The plan's two reads and the write all ran in the caller's transaction.
    expect(host.txs).toEqual([TX, TX, TX]);
  });

  it('reads outside any transaction unless given one', async () => {
    const host = memoryHost(chainNodes(['r', 'u']));
    const tree = createTenantTree(host.port);
    await tree.parentOf('u');
    await tree.parentOf('u', TX);
    expect(host.txs).toEqual([undefined, TX]);
  });

  it('makes a unit a standalone root', async () => {
    const host = memoryHost(chainNodes(['r', 'u', 'v']));
    expect(await createTenantTree(host.port).move('u', null, TX)).toBe(2);
    expect(host.moves[0]).toEqual({ id: 'u', parentId: null, parentPath: null, fromPath: '/r/u/', toPath: '/u/' });
    expect(host.rows.get('v')).toEqual({ id: 'v', parentId: 'u', path: '/u/v/' });
  });

  it('moves a deep subtree down a deep chain', async () => {
    const host = memoryHost([...chainNodes(DEEP), ...chainNodes(['x0', 'x1', 'x2'])]);
    expect(await createTenantTree(host.port).move('x1', 't11', TX)).toBe(2);
    expect(host.rows.get('x2')?.path).toBe(`/${DEEP.join('/')}/x1/x2/`);
    expect(depthOf(host.rows.get('x2')?.path ?? '')).toBe(13);
  });

  it('writes nothing for a tenant already where it is asked to go', async () => {
    const host = memoryHost(chainNodes(['r', 'u']));
    expect(await createTenantTree(host.port).move('u', 'r', TX)).toBe(0);
    expect(host.moves).toEqual([]);
  });

  it('refuses, by name, when the host finds the tree changed under the plan', async () => {
    const host = memoryHost([...chainNodes(['r', 'u']), { id: 's', parentId: null, path: '/s/' }]);
    host.port.moveSubtree = async () => 0;
    expect((await refusal(createTenantTree(host.port).move('u', 's', TX))).code).toBe('moved');
  });

  it('refuses an unknown tenant or parent before writing', async () => {
    const host = memoryHost(chainNodes(['r']));
    const tree = createTenantTree(host.port);
    expect((await refusal(tree.move('ghost', 'r', TX))).code).toBe('unknown-tenant');
    expect((await refusal(tree.move('r', 'ghost', TX))).code).toBe('unknown-tenant');
    expect(host.moves).toEqual([]);
  });
});
