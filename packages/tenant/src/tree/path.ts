/**
 * The materialized path of the tenant tree: pure, no I/O.
 *
 * A path is `/` + each id from the root down to the tenant itself, each
 * followed by `/`: a root's is `/<id>/`, a unit's `/<root>/<id>/`. Because it
 * ends in `/`, "this tenant and everything below it" is exactly the paths that
 * START with its path, which a host serves with one indexed prefix (or range)
 * read; and every ancestor's id is one of its segments, which a host serves
 * with one primary-key read. Nothing ever recurses.
 */
import type { TenantTreeNode } from '../port';

/** Why a tree operation was refused. */
export type TenantTreeErrorCode =
  /** An id is not a valid path segment (empty, or containing `/`). */
  | 'invalid-id'
  /** No tenant has the id. */
  | 'unknown-tenant'
  /** The host returned a node whose path does not agree with its own row. */
  | 'corrupt-path'
  /** The move would make a tenant its own ancestor. */
  | 'cycle'
  /** The tree changed between the plan and the write: nothing was written. */
  | 'moved';

/** Thrown when a tree read or move is refused; `code` says why. */
export class TenantTreeError extends Error {
  readonly code: TenantTreeErrorCode;

  constructor(code: TenantTreeErrorCode, message: string) {
    super(`@12-apps/tenant: ${message}`);
    this.name = 'TenantTreeError';
    this.code = code;
  }
}

/** Refuse an id that cannot be a path segment. */
export function assertSegment(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.includes('/')) {
    throw new TenantTreeError('invalid-id', `"${String(id)}" cannot be a tenant id in a tree path`);
  }
}

/** The path of a root (a standalone tenant): `/<id>/`. */
export function rootPath(id: string): string {
  assertSegment(id);
  return `/${id}/`;
}

/** The path of `id` placed directly under a tenant whose path is `parentPath`. */
export function childPath(parentPath: string, id: string): string {
  parsePath(parentPath);
  assertSegment(id);
  return `${parentPath}${id}/`;
}

/**
 * A path's ids, root first. Refuses a malformed path, and one naming the same
 * id twice (a cycle cannot be written down as a path).
 */
export function parsePath(path: string): string[] {
  if (typeof path !== 'string' || !/^\/(?:[^/]+\/)+$/u.test(path)) {
    throw new TenantTreeError('corrupt-path', `"${String(path)}" is not a tree path`);
  }
  const ids = path.slice(1, -1).split('/');
  if (new Set(ids).size !== ids.length) {
    throw new TenantTreeError('corrupt-path', `"${path}" names a tenant twice`);
  }
  return ids;
}

/** How deep a path sits: 0 for a root. */
export function depthOf(path: string): number {
  return parsePath(path).length - 1;
}

/** Whether `path` is `ancestorPath` itself or anywhere below it. */
export function isWithin(path: string, ancestorPath: string): boolean {
  return path.startsWith(ancestorPath);
}

/**
 * Hold a node the host returned to its own row: the path parses, ends in the
 * node's own id, and its second-to-last segment is the node's parent (none
 * for a root). Answers the path's ids, root first.
 */
export function validateNode(node: TenantTreeNode): string[] {
  const ids = parsePath(node.path);
  const own = ids[ids.length - 1];
  const parent = ids.length > 1 ? ids[ids.length - 2] : null;
  if (own !== node.id || parent !== node.parentId) {
    throw new TenantTreeError(
      'corrupt-path',
      `tenant "${node.id}" (parent ${JSON.stringify(node.parentId)}) has the path "${node.path}"`,
    );
  }
  return ids;
}

/** The new path prefix of a subtree that moves under `parentPath` (null: becomes a root). */
export function movedPath(id: string, parentPath: string | null): string {
  return parentPath === null ? rootPath(id) : childPath(parentPath, id);
}
