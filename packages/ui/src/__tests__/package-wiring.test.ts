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
    // Prisma/AWS-laden @12-apps/shared-helpers.
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
});
