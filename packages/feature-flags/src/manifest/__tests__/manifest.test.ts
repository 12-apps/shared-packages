/**
 * The wiring-compliance suite (the report-builder shape). The manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE —
 * the same "fails in the package's own test run" guarantee with zero runtime
 * dependencies added.
 */

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from "@12-apps/wiring/producer";

import packageJson from "../../../package.json";
import { createWebFeatureFlags } from "../../react/create-feature-flags";
import { createApiFeatureFlags } from "../../server/index";
import { featureFlagsManifest } from "../index";
import { featureFlagsServerManifest } from "../server";
import { featureFlagsWebManifest } from "../web";

describe("the shared manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(featureFlagsManifest)).toBe(featureFlagsManifest);
    expect(defineServerManifest(featureFlagsManifest, featureFlagsServerManifest)).toBe(
      featureFlagsServerManifest,
    );
    expect(defineWebManifest(featureFlagsManifest, featureFlagsWebManifest)).toBe(
      featureFlagsWebManifest,
    );
  });

  it("declares the package identity and the runtime inventory", () => {
    expect(featureFlagsManifest.name).toBe("@12-apps/feature-flags");
    expect(featureFlagsManifest.contract).toBe(1);
    expect(featureFlagsManifest.server).toEqual(["http"]);
    expect(featureFlagsManifest.web).toEqual(["surface", "areas"]);
    // Mandatory for runtime manifests — the namespace the binder scopes a logger to.
    expect(featureFlagsManifest.observability).toEqual({ namespace: "feature-flags" });
  });

  it("declares NO mcp and NO permissions contribution — both absences are the design", () => {
    // Browser-only by policy: a superadmin bearer already inherits
    // cross-tenant reach over shared MCP tools, so this surface ships no
    // agent tools; and platform authority is host vocabulary (an env
    // allowlist in the origin host), so no permission id could express it.
    expect(featureFlagsManifest).not.toHaveProperty("mcp");
    expect(featureFlagsManifest).not.toHaveProperty("permissions");
  });

  it("declares the Prisma contribution prisma:sync actually copies", () => {
    expect(featureFlagsManifest.db).toEqual({
      partial: "prisma/feature-flags.prisma",
      migrations: "prisma/migrations",
    });
  });

  it("declares the packaged journeys' entry subpath", () => {
    expect(featureFlagsManifest.e2e).toEqual({ entry: "@12-apps/feature-flags/e2e" });
  });

  it("mirrors the db contribution into package.json for host assemblers", () => {
    // Host-side sync tooling is plain Node reading node_modules — it cannot
    // execute this TS manifest, so the contribution lives in package.json
    // too, and this pin is what keeps the two the same shape (#291).
    expect(() => assertDbMirror(featureFlagsManifest, packageJson)).not.toThrow();
  });
});

describe("the runtime manifests", () => {
  it("hands hosts the existing factories, not wrappers that could drift", () => {
    expect(featureFlagsServerManifest.http?.create).toBe(createApiFeatureFlags);
    expect(featureFlagsWebManifest.surface?.create).toBe(createWebFeatureFlags);
  });

  it("suggests the super-admin area as one route with a matching nav anchor", () => {
    const area = featureFlagsWebManifest.areas?.[0];
    expect(area?.area).toBe("super-admin");
    expect(area?.routes?.map((route) => route.path)).toEqual(["feature-flags"]);
    expect(area?.nav?.[0]?.path).toBe("feature-flags");
    // No permission/feature gates: host vocabulary, per the areas contract.
    expect("permission" in (area?.nav?.[0] ?? {})).toBe(false);
    expect("feature" in (area?.routes?.[0] ?? {})).toBe(false);
  });
});
