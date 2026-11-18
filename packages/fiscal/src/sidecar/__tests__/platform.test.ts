import { describe, expect, it } from "vitest";

import extensionsJson from "../../../sidecar/extensions.json";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SIDECAR_PHP_EXTENSIONS, SIDECAR_PHP_LAUNCH_FLAGS, SIDECAR_PHP_SETTINGS, SIDECAR_PHP_VERSION } from "../platform";

/** The TypeScript copy of the service's platform list is the file's, value for value. */
describe("the fiscal service's platform (FUT-4717)", () => {
  it("lists the same PHP version and extensions as sidecar/extensions.json", () => {
    expect(SIDECAR_PHP_VERSION).toBe(extensionsJson.php);
    expect([...SIDECAR_PHP_EXTENSIONS]).toEqual(extensionsJson.extensions);
  });

  it("launches with the settings of sidecar/extensions.json, as the README documents them", () => {
    expect(SIDECAR_PHP_SETTINGS).toEqual(extensionsJson.ini);
    expect(SIDECAR_PHP_LAUNCH_FLAGS).toContain("zend.exception_ignore_args=1");
    // The README is a checked-in fixture read once, not state another test writes.
    // eslint-disable-next-line test-flakiness/no-unmocked-fs -- reads a tracked doc, deterministic
    const readme = readFileSync(join(import.meta.dirname, "../../../sidecar/README.md"), "utf8").replace(/\\\n\s*/g, "");
    expect(readme).toContain(SIDECAR_PHP_LAUNCH_FLAGS.join(" "));
  });

  it("carries what the transport and the libraries need beyond the ticket's first list", () => {
    expect(SIDECAR_PHP_EXTENSIONS).toEqual(expect.arrayContaining(["curl", "mbstring", "filter", "reflection"]));
  });
});
