import type { PermissionKind, PermissionRegistry } from './types';

/**
 * Build a permission registry from either:
 *
 * - a literal tuple of permission strings (backward-compatible form) — every
 *   permission defaults to the `'class'` scope-kind; or
 * - an object map `{ 'orders:read:own': 'instance', 'products:write': 'class' }`
 *   declaring each permission's scope-kind explicitly.
 *
 * Pass the tuple `as const` (or `const` map) so the derived union is a string
 * literal union, giving compile-time safety when a typed engine checks
 * permissions.
 *
 * @example
 * definePermissions(['posts:read', 'posts:write']);       // all 'class'
 * definePermissions({ 'posts:read:own': 'instance', 'posts:write': 'class' });
 */
export function definePermissions<const T extends readonly string[]>(
  perms: T,
): PermissionRegistry<T[number]>;
export function definePermissions<
  const M extends Record<string, PermissionKind>,
>(perms: M): PermissionRegistry<keyof M & string>;
export function definePermissions(
  perms: readonly string[] | Record<string, PermissionKind>,
): PermissionRegistry<string> {
  const list = Array.isArray(perms) ? [...perms] : Object.keys(perms);
  const set = new Set<string>(list);
  const kinds = new Map<string, PermissionKind>();
  if (!Array.isArray(perms)) {
    for (const [p, k] of Object.entries(
      perms as Record<string, PermissionKind>,
    )) {
      kinds.set(p, k);
    }
  }
  return {
    list,
    has(p: string): p is string {
      return set.has(p);
    },
    kind(p: string): PermissionKind {
      return kinds.get(p) ?? 'class';
    },
  };
}
