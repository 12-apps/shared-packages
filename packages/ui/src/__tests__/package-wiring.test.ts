import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "../../package.json");

interface UiPackageJson {
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  typesVersions?: Record<string, Record<string, string[]>>;
}

function readPkg(): UiPackageJson {
  return JSON.parse(readFileSync(pkgPath, "utf8")) as UiPackageJson;
}

describe("@12-apps/ui package wiring (Task 5)", () => {
  it("declares @12-apps/shared-helpers as a workspace:* dependency", () => {
    const pkg = readPkg();
    expect(pkg.dependencies?.["@12-apps/shared-helpers"]).toBe("workspace:*");
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
