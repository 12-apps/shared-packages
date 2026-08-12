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

  it("exposes the ./form/total-form package export", () => {
    const pkg = readPkg();
    expect(pkg.exports?.["./form/total-form"]).toBe(
      "./src/components/form/total-form/index.ts",
    );
  });

  it("registers a form/* typesVersions entry covering total-form", () => {
    const pkg = readPkg();
    const formTypes = pkg.typesVersions?.["*"]?.["form/*"];
    expect(formTypes).toContain("./src/components/form/*/index.d.ts");
  });

  /**
   * Every subpath must be an entry point Vite is willing to PRE-BUNDLE.
   *
   * `exports` points at this package's own source, so a consumer's bundler
   * follows it directly. Vite decides what it may pre-bundle with
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
   * So a component's entry point is its `index.ts` barrel — which is what
   * every component under `src/components/**` already does. These three were
   * the stragglers.
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
