import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildEntries } from "../../scripts/build-entries.mjs";

/**
 * Every source module is its OWN build entry, and stays one.
 *
 * tsup BUNDLES an entry, so a barrel like `navigation/AppHeader/index.ts` used
 * to flatten the bar, its brand row, its identity row and the details panel
 * behind its disclosure into one `dist/navigation/AppHeader.js`. Once they are
 * one module a consumer's bundler cannot separate them: an app rendering only
 * the bar still shipped the panel, and through it the sheet, the dialog and
 * some fifty `@mui/material` component modules underneath. That is not a
 * tree-shaking failure — it is a module boundary that no longer exists to shake
 * along.
 *
 * Naming every source file as an entry gives this package `@mui/material`'s own
 * shape: one component per module, a barrel that only re-exports, and therefore
 * an unused export that is an unused MODULE and disappears.
 *
 * This is a COMPLETENESS property, so it is asserted the way the other budgets
 * here are: against the real tree rather than a list. A narrowed glob, a new
 * directory the ignore patterns happen to swallow, or a `src/` layout change
 * would each quietly restore the old shape — and nothing else in this package
 * would go red, because the output would still be correct, just re-fused.
 */

/**
 * Vitest runs with the package as its working directory.
 *
 * `import.meta.url` is not a file URL under this package's jsdom environment,
 * so the usual `fileURLToPath` idiom throws here. The guard below is what makes
 * `cwd` safe to rely on: a wrong root would otherwise find no source files and
 * report a clean sweep.
 */
const PACKAGE_ROOT = `${process.cwd()}/`;

/** Every shipped source module, found the same way a reader would. */
function sourceModules(directory: string): string[] {
  // The claim is about the real tree; a mocked one would assert only what this
  // file put in it.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "__tests__") return [];
    const full = join(directory, entry);
    // eslint-disable-next-line test-flakiness/no-unmocked-fs
    if (statSync(full).isDirectory()) return sourceModules(full);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.(stories|test)\./.test(entry) || entry.endsWith(".d.ts")) return [];
    return [full.slice(PACKAGE_ROOT.length)];
  });
}

describe("the build emits one module per component", () => {
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  if (!existsSync(join(PACKAGE_ROOT, "entries.json"))) {
    throw new Error(`expected the @12-apps/ui package root, got ${PACKAGE_ROOT}`);
  }

  const entries = buildEntries(PACKAGE_ROOT);
  const built = new Set(Object.values(entries));

  it("names every shipped source module as an entry", () => {
    const missing = sourceModules(join(PACKAGE_ROOT, "src")).filter((file) => !built.has(file));

    expect(missing).toEqual([]);
  });

  it("names each module exactly once, so nothing is emitted twice", () => {
    // Two names for one module is how a build ends up with two copies of it —
    // which is the duplicate-context failure `splitting: true` exists to
    // prevent, arriving by a different door.
    expect(built.size).toBe(Object.values(entries).length);
  });

  it("keeps every PUBLIC subpath at the output path its exports map names", () => {
    // The internal half is namespaced away from the public keys on purpose: a
    // collision would move a published subpath's file and break the manifest
    // that `sync-exports.mjs` generates from the same list.
    const internal = Object.keys(entries).filter((key) => key.startsWith("_internal/"));

    expect(internal.length).toBeGreaterThan(0);
    expect(Object.keys(entries).length - internal.length).toBe(135);
  });

  it("builds no story or spec — each would drag a test runner into dist", () => {
    expect(Object.values(entries).filter((file) => /\.(stories|test)\./.test(file))).toEqual([]);
  });
});
