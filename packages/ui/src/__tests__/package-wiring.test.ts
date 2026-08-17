import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Load the package's OWN manifest via require (no fs.readFileSync — so this
// asserts real dependency wiring without tripping the anti-flake fs rule; the
// manifest is a deterministic, package-local file).
const requireJson = createRequire(import.meta.url);

interface UiPackageJson {
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  typesVersions?: Record<string, Record<string, string[]>>;
}

function readPkg(): UiPackageJson {
  return requireJson("../../package.json") as UiPackageJson;
}

describe("@12-apps/ui package wiring (Task 5)", () => {
  it("depends on the leaf @12-apps/forms-core, not the heavy @12-apps/shared-helpers", () => {
    const pkg = readPkg();
    // @12-apps/ui must stay self-contained: it uses the zero-dependency
    // @12-apps/forms-core for form validation and must NOT pull in the
    // AWS-laden @12-apps/shared-helpers.
    expect(pkg.dependencies?.["@12-apps/forms-core"]).toBe("workspace:*");
    expect(pkg.dependencies?.["@12-apps/shared-helpers"]).toBeUndefined();
  });

  /**
   * The shape changed in 12-51 and the assertion changed with it, deliberately.
   *
   * It used to pin the raw source path, `./src/components/form/total-form/
   * index.ts`. That is exactly what made this package unloadable by Node, which
   * refuses to strip types below `node_modules` — so the old expectation was
   * pinning the bug. Every subpath now names a compiled target and its emitted
   * declarations, generated from `entries.json` by `scripts/sync-exports.mjs`.
   *
   * Kept as a spot-check on one entry rather than deleted: `total-form` is the
   * export this test was written for, and a generated 129-entry map still
   * deserves one hand-written example that says what a correct entry looks like.
   */
  it("exposes the ./form/total-form package export, compiled", () => {
    const pkg = readPkg();
    expect(pkg.exports?.["./form/total-form"]).toEqual({
      types: "./dist/types/components/form/total-form/index.d.ts",
      default: "./dist/form/total-form.js",
    });
  });

  /**
   * `typesVersions` is the fallback for a consumer on `moduleResolution: node`,
   * which ignores `exports`. It pointed under `./src/components/` at
   * `index.d.ts` files that have never existed, because the source is `.ts` and
   * nothing emitted declarations beside it. So the fallback silently resolved
   * to nothing for every such consumer.
   *
   * 12-51 repoints it at the declarations `tsc --emitDeclarationOnly` now
   * writes. Kept rather than deleted: removing it would change what an older
   * consumer resolves, and a real fallback is strictly better than a dead one.
   */
  it("registers a form/* typesVersions entry covering total-form", () => {
    const pkg = readPkg();
    const formTypes = pkg.typesVersions?.["*"]?.["form/*"];
    expect(formTypes).toContain("./dist/types/components/form/*/index.d.ts");
  });

  /**
   * Every subpath must be an entry point Vite is willing to PRE-BUNDLE.
   *
   * Vite decides what it may pre-bundle with
   *
   *     OPTIMIZABLE_ENTRY_RE = /\.[cm]?[jt]s$/
   *
   * which matches `.js`/`.mjs`/`.cjs`/`.ts`/`.mts`/`.cts` and NOT `.tsx`. A
   * `.tsx` entry is therefore served to the browser as raw source, and its
   * imports are followed as source too — the whole `@mui/material` barrel,
   * then `@emotion/react`, then the CJS leaves under it. A CJS file handed
   * over as ESM has no default export, so the first one evaluated throws and
   * React never mounts.
   *
   * The consumer sees a blank page and a clean build log. `./button`,
   * `./social-login-button` and `./user-avatar` shipped that way and took out
   * 41 storefront e2e specs downstream, none of which import them.
   *
   * Since 12-51 every subpath resolves to compiled `./dist/**.js`, so the
   * hazard is structurally gone rather than merely avoided — a `.tsx` can no
   * longer BE an entry target. The assertion stays anyway: it costs nothing,
   * and it is the thing that would notice if the exports map were ever
   * hand-edited back towards source.
   */
  it("exposes every subpath through a bundler-optimizable entry point", () => {
    const OPTIMIZABLE_ENTRY_RE = /\.[cm]?[jt]s$/;
    const targets = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.flatMap(targets);
      if (value && typeof value === "object") return Object.values(value).flatMap(targets);
      return [];
    };

    const entries = Object.entries(readPkg().exports ?? {}).flatMap(([subpath, value]) =>
      targets(value).map((target) => `${subpath} => ${target}`),
    );
    // Guard the guard: an empty map would make the assertion below vacuous.
    expect(entries.length).toBeGreaterThan(0);

    expect(entries.filter((entry) => !OPTIMIZABLE_ENTRY_RE.test(entry.split(" => ")[1] ?? ""))).toEqual(
      [],
    );
  });
});
