/**
 * What every SPA downloads at boot from this package holds no Sentry (FUT-1023).
 *
 * `.` is imported by each app's `main.tsx`, and `./react` by the app shell's
 * route boundary, which mounts before the first render. Anything either reaches
 * through a STATIC import lands in the app's entry chunk. The SDK must arrive
 * only through `index.ts`'s `import("./sdk")` after `load`: one value import of
 * `@sentry/*` anywhere on this graph puts about 28 KB brotli back on the
 * storefront's first paint, and every unit test still passes.
 *
 * FUT-1023's first attempt was defeated by exactly such an edge:
 * `react/error-boundary.tsx` imports `reportRouteCrash` from `../index`, which
 * then imported the SDK at its top.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The package's boot entries: the `.` and `./react` exports. */
const BOOT_ENTRIES = ["index.ts", "react/index.ts"];

/**
 * Every specifier a file imports or re-exports STATICALLY, by value.
 *
 * `import type` and `export type` are erased; `import()` is not static. A
 * statement mixing values and inline `type` names still counts, since it keeps
 * the module.
 */
function staticSpecifiers(source: string): string[] {
  const statement = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm;
  const bare = /^\s*import\s+["']([^"']+)["']/gm;
  const found: string[] = [];
  for (const match of source.matchAll(statement)) {
    if (match[2] === undefined) found.push(match[4] ?? "");
  }
  for (const match of source.matchAll(bare)) found.push(match[1] ?? "");
  return found;
}

function resolveLocal(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // not this one
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${from}`);
}

/** Every external package the boot entries reach statically, with the path to it. */
function bootExternals(): Map<string, string> {
  const externals = new Map<string, string>();
  const seen = new Set<string>();
  const queue = BOOT_ENTRIES.map((entry) => ({ file: path.join(SRC, entry), trail: entry }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next.file)) continue;
    seen.add(next.file);
    for (const specifier of staticSpecifiers(readFileSync(next.file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        if (!externals.has(specifier)) externals.set(specifier, `${next.trail} -> ${specifier}`);
        continue;
      }
      const file = resolveLocal(next.file, specifier);
      queue.push({ file, trail: `${next.trail} -> ${path.relative(SRC, file)}` });
    }
  }
  return externals;
}

describe("the boot graph", () => {
  it("reaches no Sentry package through a static import", () => {
    const sentry = [...bootExternals()]
      .filter(([specifier]) => specifier.startsWith("@sentry/"))
      .map(([, trail]) => trail);
    expect(sentry).toEqual([]);
  });

  it("is actually walked: it reaches the boundary and React", () => {
    // Guards the walker itself. A parser that found nothing would pass the
    // case above on any tree.
    const externals = bootExternals();
    expect(externals.has("react")).toBe(true);
    expect(externals.get("react-router-dom")).toContain("react/route.tsx");
  });
});
