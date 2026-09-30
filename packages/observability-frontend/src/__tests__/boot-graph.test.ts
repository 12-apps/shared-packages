/**
 * What every SPA downloads at boot from this package holds no Sentry (FUT-1023).
 *
 * `.` is imported by each app's `main.tsx`, and `./react` by the app shell's
 * route boundary, which mounts before the first render. Anything either reaches
 * through a STATIC import lands in the app's entry chunk. The SDK must arrive
 * only through `index.ts`'s `import("./sdk")` once the page has finished
 * downloading: one value import of `@sentry/*` anywhere on this graph puts about
 * 28 KB brotli back on the storefront's first paint, and every unit test still
 * passes.
 *
 * FUT-1023's first attempt was defeated by exactly such an edge:
 * `react/error-boundary.tsx` imports `reportRouteCrash` from `../index`, which
 * then imported the SDK at its top.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

/** The `?raw` glob helper Vite injects; declared locally to avoid `any`. */
interface RawGlob {
  glob(
    pattern: string[],
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, string>;
}

/**
 * The package's checked-in source, inlined by Vite at transform time: the real
 * bytes are under test with no filesystem call made while it runs. Keyed by
 * path relative to `src/`.
 */
// eslint-disable-next-line test-flakiness/no-unmocked-fs -- not a filesystem call: `import.meta.glob` is erased by Vite at transform time and the contents are inlined into the bundle, so nothing is read while the test runs. The rule matches the identifier `glob`.
const RAW = (import.meta as unknown as RawGlob).glob(["../**/*.ts", "../**/*.tsx", "!../**/__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const SOURCES = new Map(Object.entries(RAW).map(([key, source]) => [path.posix.normalize(key.slice(3)), source]));

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
  const base = path.posix.join(path.posix.dirname(from), specifier);
  const file = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => SOURCES.has(candidate));
  if (file === undefined) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return file;
}

/** Every external package the boot entries reach statically, with the path to it. */
function bootExternals(): Map<string, string> {
  const externals = new Map<string, string>();
  const seen = new Set<string>();
  const queue = BOOT_ENTRIES.map((entry) => ({ file: entry, trail: entry }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next.file)) continue;
    seen.add(next.file);
    for (const specifier of staticSpecifiers(SOURCES.get(next.file) ?? "")) {
      if (!specifier.startsWith(".")) {
        if (!externals.has(specifier)) externals.set(specifier, `${next.trail} -> ${specifier}`);
        continue;
      }
      const file = resolveLocal(next.file, specifier);
      queue.push({ file, trail: `${next.trail} -> ${file}` });
    }
  }
  return externals;
}

describe("the boot graph", () => {
  it("reaches no Sentry package through a static import", () => {
    const sentry = [...bootExternals()]
      .filter((external) => external[0].startsWith("@sentry/"))
      .map((external) => external[1]);
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
