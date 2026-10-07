import { assertExportsMirror, defineManifest, defineServerManifest, defineWebManifest } from "@12-apps/wiring/producer";
import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { routingManifest } from "../manifest/index";
import { routingServerManifest } from "../manifest/server";
import { routingWebManifest } from "../manifest/web";

/**
 * The wiring compliance suite, run here because the manifests are plain
 * `satisfies` values (wiring stays a type-only edge).
 */
describe("the routing manifests", () => {
  it("declare a valid shared manifest", () => {
    expect(defineManifest(routingManifest)).toBe(routingManifest);
  });

  it("match the inventory for both runtimes", () => {
    expect(defineServerManifest(routingManifest, routingServerManifest)).toBe(routingServerManifest);
    expect(defineWebManifest(routingManifest, routingWebManifest)).toBe(routingWebManifest);
  });

  it("mirror every runtime in package.json", () => {
    expect(() => assertExportsMirror(routingManifest, packageJson)).not.toThrow();
  });
});
