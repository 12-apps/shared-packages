import { describe, expect, it } from "vitest";

import extensionsJson from "../../../sidecar/extensions.json";
import { SIDECAR_PHP_EXTENSIONS, SIDECAR_PHP_VERSION } from "../platform";

/** The TypeScript copy of the service's platform list is the file's, value for value. */
describe("the fiscal service's platform (FUT-4717)", () => {
  it("lists the same PHP version and extensions as sidecar/extensions.json", () => {
    expect(SIDECAR_PHP_VERSION).toBe(extensionsJson.php);
    expect([...SIDECAR_PHP_EXTENSIONS]).toEqual(extensionsJson.extensions);
  });

  it("carries what the transport and the libraries need beyond the ticket's first list", () => {
    expect(SIDECAR_PHP_EXTENSIONS).toEqual(expect.arrayContaining(["curl", "mbstring", "filter", "reflection"]));
  });
});
