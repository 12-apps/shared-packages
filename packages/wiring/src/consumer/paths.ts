/**
 * Route-path mechanics: joining, claim keys, and specificity ordering.
 *
 * Ordering is the load-bearing part. Hono resolves by REGISTRATION order, so
 * every hand-assembled host carries a "more-specific-first" rule as prose —
 * the reference harness's `mount-surfaces.ts` spends its header explaining
 * why reversing two mounts is a bug. Sorting the aggregate here turns that
 * prose into data: a static segment outranks a `:param` at the same
 * position, and a longer path outranks its own prefix, deterministically.
 */

import type { MountedRoute } from "../contract/http";

/**
 * A mount prefix in OpenAPI `{param}` form, for MCP tool paths:
 * `/api/admin/:tenantSlug` → `/api/admin/{tenantSlug}`. What lets a manifest
 * declare its tools against the SAME relative paths as its route descriptors.
 */
export function openApiMountPrefix(mountPath: string): string {
  const prefix = mountPath
    .split("/")
    .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
    .join("/");
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

/** Join a host mount prefix and a package-relative path. */
export function joinRoutePath(mountPath: string, path: string): string {
  const left = mountPath.endsWith("/") ? mountPath.slice(0, -1) : mountPath;
  const right = path.startsWith("/") ? path : `/${path}`;
  const joined = `${left}${right}`;
  return joined === "" ? "/" : joined;
}

const PARAM = ":param";

function segmentsOf(fullPath: string): string[] {
  return fullPath
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => (segment.startsWith(":") ? PARAM : segment));
}

/**
 * The identity of a route CLAIM: method plus the path with every param
 * equated. Two routes with the same key answer the same requests, whatever
 * their params are called — which is what makes the key the conflict unit.
 */
export function routeClaimKey(method: string, fullPath: string): string {
  return `${method} /${segmentsOf(fullPath).join("/")}`;
}

function compareSegments(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const left = a[index] ?? "";
    const right = b[index] ?? "";
    if (left === right) continue;
    if (left === PARAM) return 1;
    if (right === PARAM) return -1;
    return left < right ? -1 : 1;
  }
  // One is the other's prefix: the LONGER one is more specific, so it sorts
  // first — the drafts-before-:id rule, derived instead of remembered.
  return b.length - a.length;
}

/**
 * Registration order for an aggregate of mounted routes: specificity first,
 * then method and package name purely for determinism.
 */
export function sortRoutes(routes: readonly MountedRoute[]): MountedRoute[] {
  return [...routes].sort((a, b) => {
    const byPath = compareSegments(
      segmentsOf(joinRoutePath(a.mountPath, a.route.path)),
      segmentsOf(joinRoutePath(b.mountPath, b.route.path)),
    );
    if (byPath !== 0) return byPath;
    const byMethod = a.route.method.localeCompare(b.route.method);
    return byMethod !== 0 ? byMethod : a.packageName.localeCompare(b.packageName);
  });
}

/** A route claim two adopted packages both make. */
export interface RouteConflict {
  claim: string;
  packages: readonly string[];
}

/** Every claim made more than once across the aggregate. */
export function findRouteConflicts(routes: readonly MountedRoute[]): RouteConflict[] {
  const owners = new Map<string, string[]>();
  routes.forEach((mounted) => {
    const claim = routeClaimKey(
      mounted.route.method,
      joinRoutePath(mounted.mountPath, mounted.route.path),
    );
    const list = owners.get(claim) ?? [];
    list.push(mounted.packageName);
    owners.set(claim, list);
  });
  return [...owners.entries()]
    .filter(([, packages]) => packages.length > 1)
    .map(([claim, packages]) => ({ claim, packages }));
}

/**
 * The descriptors a host has NOT mounted, for hosts that keep one route file
 * per endpoint (coverage gates read guards out of route files, so those
 * hosts cannot mount the aggregate directly). `claimed` carries the keys the
 * host's route table serves, in `METHOD /full/path` form with any `:param`
 * spelling. A unit test asserting this returns `[]` is what turns "a version
 * bump shipped endpoints the host never mounted" into a red test.
 */
export function unclaimedRoutes(
  routes: readonly MountedRoute[],
  claimed: Iterable<string>,
): MountedRoute[] {
  const covered = new Set(
    [...claimed].map((key) => {
      const space = key.indexOf(" ");
      return routeClaimKey(key.slice(0, space), key.slice(space + 1));
    }),
  );
  return routes.filter(
    (mounted) =>
      !covered.has(
        routeClaimKey(mounted.route.method, joinRoutePath(mounted.mountPath, mounted.route.path)),
      ),
  );
}
