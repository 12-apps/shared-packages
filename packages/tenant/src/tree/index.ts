/**
 * The tenant tree: ownership of any depth (a company above its units, a unit
 * above its venues), read and moved through the tenant port only. The package
 * owns no tenant row: it computes and validates every path, refuses a cycle
 * and plans a move; the host stores the paths and applies the plan.
 *
 * Every read is ONE port call at any depth (`parentOf`, `rootOf` read the
 * tenant's own node; `ancestorsOf` and `descendantsOf` one indexed read each).
 * A move is two node reads and ONE write that rewrites the whole subtree.
 *
 * Participation (a tenant selling inside another tenant's space) is not a
 * parent: the tree is ownership only.
 */
import type { TenantPort, TenantTreeMove, TenantTreeNode } from '../port';
import {
  TenantTreeError,
  assertSegment,
  depthOf,
  isWithin,
  movedPath,
  validateNode,
} from './path';

export {
  TenantTreeError,
  childPath,
  depthOf,
  isWithin,
  parsePath,
  rootPath,
  validateNode,
  type TenantTreeErrorCode,
} from './path';

/** The tree's half of the port. */
export type TenantTreePort = Pick<
  TenantPort,
  'treeNode' | 'treeAncestors' | 'treeDescendants' | 'moveSubtree'
>;

export interface TenantTree {
  /** The tenant directly above `id`, or null for a root. One port call. */
  parentOf(id: string): Promise<string | null>;
  /** The root of `id`'s tree (`id` itself for a root). One port call. */
  rootOf(id: string): Promise<string>;
  /** Every tenant above `id`, nearest first; empty for a root. One port call. */
  ancestorsOf(id: string): Promise<TenantTreeNode[]>;
  /** Every tenant below `id` at any depth, shallowest first; `id` excluded. One port call. */
  descendantsOf(id: string): Promise<TenantTreeNode[]>;
  /**
   * Move `id`, with everything below it, under `parentId` (null: make it a
   * root). Refuses a cycle before anything is written; answers the rows the
   * host rewrote. Throws `moved` when the tree changed under the plan.
   */
  move(id: string, parentId: string | null): Promise<number>;
}

async function nodeOf(port: TenantTreePort, id: string): Promise<{ node: TenantTreeNode; ids: string[] }> {
  assertSegment(id);
  const node = await port.treeNode(id);
  if (node === null) throw new TenantTreeError('unknown-tenant', `no tenant "${id}"`);
  return { node, ids: validateNode(node) };
}

/** Shallowest first, then by id, so equal depths answer in a stable order. */
function byDepth(a: TenantTreeNode, b: TenantTreeNode): number {
  return depthOf(a.path) - depthOf(b.path) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The read's nodes, each validated; refuses a read that lost its own tenant. */
function checked(id: string, nodes: readonly TenantTreeNode[]): TenantTreeNode[] {
  nodes.forEach(validateNode);
  if (!nodes.some((node) => node.id === id)) {
    throw new TenantTreeError('unknown-tenant', `no tenant "${id}"`);
  }
  return [...nodes].sort(byDepth);
}

export function createTenantTree(port: TenantTreePort): TenantTree {
  return {
    async parentOf(id) {
      return (await nodeOf(port, id)).node.parentId;
    },

    async rootOf(id) {
      const { ids } = await nodeOf(port, id);
      return ids[0] as string;
    },

    async ancestorsOf(id) {
      assertSegment(id);
      const nodes = checked(id, await port.treeAncestors(id));
      const self = nodes[nodes.length - 1] as TenantTreeNode;
      // Exactly the ids the tenant's own path names above it, no more, no fewer.
      const above = validateNode(self).slice(0, -1);
      const ancestors = nodes.filter((node) => node.id !== id);
      if (ancestors.length !== above.length || ancestors.some((node, index) => node.id !== above[index])) {
        throw new TenantTreeError('corrupt-path', `the ancestors read for "${id}" disagree with "${self.path}"`);
      }
      return ancestors.reverse();
    },

    async descendantsOf(id) {
      assertSegment(id);
      const nodes = checked(id, await port.treeDescendants(id));
      const self = nodes[0] as TenantTreeNode;
      if (self.id !== id || nodes.some((node) => !isWithin(node.path, self.path))) {
        throw new TenantTreeError('corrupt-path', `the descendants read for "${id}" left "${self.path}"`);
      }
      return nodes.slice(1);
    },

    async move(id, parentId) {
      const { node } = await nodeOf(port, id);
      let parentPath: string | null = null;
      if (parentId !== null) {
        if (parentId === id) throw new TenantTreeError('cycle', `"${id}" cannot be its own parent`);
        const parent = (await nodeOf(port, parentId)).node;
        if (isWithin(parent.path, node.path)) {
          throw new TenantTreeError('cycle', `"${id}" cannot move under "${parentId}", which sits below it`);
        }
        parentPath = parent.path;
      }
      const plan: TenantTreeMove = {
        id,
        parentId,
        parentPath,
        fromPath: node.path,
        toPath: movedPath(id, parentPath),
      };
      if (plan.toPath === plan.fromPath) return 0; // already there
      const written = await port.moveSubtree(plan);
      if (written === 0) {
        throw new TenantTreeError('moved', `the tree changed while "${id}" was moving; nothing was written`);
      }
      return written;
    },
  };
}
