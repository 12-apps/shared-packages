import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { urlPathOf, walkRouteFiles } from "@12-apps/rbac/coverage";

/**
 * The route-METHOD half of the surface scan (12-23) — what `mcp:coverage` needs
 * on top of what `rbac:coverage` already ships.
 *
 * The WALK is imported from `@12-apps/rbac/coverage` rather than copied, and that
 * is deliberate: both gates assert a COMPLETENESS property over the same two
 * surfaces (`app/**` route files and `*actions.ts` modules), and future-pay's own
 * comment on the shared scanner says why they must share it — "so the two gates
 * can never disagree about what the surface is". Two copies would agree on the day
 * they were written and drift silently after, in the direction of not looking.
 *
 * THE SCAN ROOT IS THE WHOLE `app` FOLDER, never `app/api`: a completeness gate
 * rooted below the surface it claims to cover does not fail when it misses
 * something, it simply never looks. Three OAuth/JWKS discovery routes shipped
 * unregistered for exactly as long as the walk was rooted at `app/api`.
 *
 * Detection is regex-over-source (no TS compiler): fast, dependency-free, and it
 * matches how the framework itself keys routes off file paths plus exported names.
 */

/** Every method a route file can serve — the scan must see them all. */
export const HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

/** One exported HTTP handler discovered on a route file. */
export interface RouteMethod {
  /** URL path with `[param]` → `{param}` (e.g. `/api/checkout/{id}`). */
  urlPath: string;
  /** The HTTP method exported (GET/POST/…). */
  method: string;
  /** The route file, relative to the web root. */
  file: string;
}

/**
 * Exported HTTP methods, across every form the app router serves:
 * `export const GET`, `export async function GET`,
 * `export const { GET, POST } = handlers`, `export { handler as GET }`. For brace
 * lists the exported name is the last identifier of each item (after `as`, or
 * after `:` for destructuring renames). `export type { … }` never matches — a type
 * is never a handler.
 */
export function exportedMethodsOf(source: string): string[] {
  const found = new Set<string>();
  const single =
    /export\s+(?:const|async\s+function|function)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g;
  for (const match of source.matchAll(single)) found.add(match[1] as string);
  const braceList = /export\s+(?:const\s+)?\{([^}]+)\}/g;
  for (const match of source.matchAll(braceList)) {
    (match[1] as string)
      .split(",")
      .map((item) => item.trim().split(/\s+as\s+|\s*:\s*/).pop() ?? "")
      .filter((name) => (HTTP_METHODS as readonly string[]).includes(name))
      .forEach((name) => found.add(name));
  }
  return [...found];
}

/** Every exported HTTP handler across all route files under `appDir`. */
export function collectRouteMethods(appDir: string, webRoot: string): RouteMethod[] {
  return walkRouteFiles(appDir).flatMap((file) => {
    const urlPath = urlPathOf(file, appDir);
    return exportedMethodsOf(readFileSync(file, "utf8")).map((method) => ({
      urlPath,
      method,
      file: relative(webRoot, file),
    }));
  });
}
