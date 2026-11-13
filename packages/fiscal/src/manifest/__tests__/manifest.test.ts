import { describe, expect, it } from "vitest";
import { assertDbMirror, assertEnvMirror, assertExportsMirror, defineManifest } from "@12-apps/wiring/producer";
import { createWiringHost } from "@12-apps/wiring/consumer";

import packageJson from "../../../package.json";
import { FISCAL_PERMISSIONS, fiscalManifest } from "..";

/**
 * The wiring-compliance suite for the skeleton: the producer's assertions
 * (the contract is a type-only dependency, so they run here), the mirrors,
 * and an adoption by a real wiring host.
 */

describe("the fiscal manifest", () => {
  it("passes the producer assertions", () => {
    expect(defineManifest(fiscalManifest)).toBe(fiscalManifest);
  });

  it("declares the identity and the permissions, and no runtime yet", () => {
    expect(fiscalManifest).toEqual({
      name: "@12-apps/fiscal",
      contract: 1,
      permissions: FISCAL_PERMISSIONS,
    });
  });

  it("declares the four permissions, and only them", () => {
    expect(FISCAL_PERMISSIONS.ids).toEqual(["fiscal:read", "fiscal:manage", "fiscal:issue", "fiscal:cancel"]);
    expect(Object.keys(FISCAL_PERMISSIONS.permissions)).toEqual([...FISCAL_PERMISSIONS.ids]);
  });

  it("mirrors the db and env absence and the exports map into package.json", () => {
    expect(() => assertDbMirror(fiscalManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(fiscalManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(fiscalManifest, packageJson)).not.toThrow();
  });

  it("ships the engine and the tables beside the manifest", () => {
    expect(Object.keys(packageJson.exports)).toEqual(["./engine", "./manifest", "./tables/*", "./package.json"]);
    expect(packageJson.files).toContain("tables");
  });

  it("is adopted by a server host, which collects the permissions", () => {
    const host = createWiringHost({ name: "host", kind: "server", ports: {} });
    host.adoptServer({ manifest: fiscalManifest });
    expect(host.assemble().permissions).toEqual([FISCAL_PERMISSIONS]);
  });
});
