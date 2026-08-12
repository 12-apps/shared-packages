import { readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Static-scan helpers for the RBAC coverage gate (12-13) — the discovery half
 * of future-pay's `scripts/lib/surface-scan.ts`, shipped with the package so
 * the gate and the guards it looks for version together.
 *
 * THE SCAN ROOT IS THE WHOLE `app` FOLDER, never `app/api`, and that is
 * load-bearing: a completeness gate rooted below the surface it claims to
 * cover does not fail when it misses something — it simply never looks.
 *
 * Detection is deliberately regex-over-source (no TS compiler): fast,
 * dependency-free, and matching how the app router keys routes off file paths
 * plus exported names.
 */

/** Recursively collect every `route.ts` under `dir` (skipping node_modules). */
export function walkRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

/** Recursively collect every `*actions.ts` under `dir`. */
export function walkActionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkActionFiles(full);
    return /(^|-)actions\.ts$/.test(entry.name) ? [full] : [];
  });
}

/**
 * `app/api/checkout/[id]/route.ts` → `/api/checkout/{id}` (catch-alls too).
 * Relative to `appDir`, so it is agnostic about the first segment.
 */
export function urlPathOf(routeFile: string, appDir: string): string {
  const segments = relative(appDir, dirname(routeFile)).split(sep);
  const mapped = segments.map((segment) =>
    segment.startsWith('[')
      ? `{${segment.replace(/^\[(\.\.\.)?/, '').replace(/\]$/, '')}}`
      : segment,
  );
  return `/${mapped.join('/')}`;
}

/**
 * Exported server-action names in a `"use server"` module. Every runtime
 * export of a use-server module IS a server action. Returns [] for a
 * non-use-server file.
 */
export function exportedActionsOf(source: string): string[] {
  if (!/^\s*["']use server["']/m.test(source)) return [];
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:async\s+function|const)\s+(\w+)/g)) {
    names.add(match[1] as string);
  }
  for (const match of source.matchAll(/export\s+(?:const\s+)?\{([^}]+)\}/g)) {
    (match[1] as string)
      .split(',')
      .map((item) => item.trim().split(/\s+as\s+|\s*:\s*/).pop() ?? '')
      .filter((name) => /^\w+$/.test(name))
      .forEach((name) => names.add(name));
  }
  return [...names];
}

/**
 * Match `urlPath` against a set of prefixes on SEGMENT boundaries only:
 * `/api/mcp` covers itself and `/api/mcp/status`, never a sibling
 * `/api/mcp-admin`. Returns the matching prefix, or undefined.
 */
export function segmentPrefixMatch(
  urlPath: string,
  prefixes: readonly string[],
): string | undefined {
  return prefixes.find((prefix) => {
    const base = prefix.replace(/\/$/, '');
    return urlPath === base || urlPath.startsWith(`${base}/`);
  });
}
