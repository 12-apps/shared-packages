/**
 * The wiring-compliance suite (the report-builder shape): the manifest is a
 * plain `satisfies`-checked value with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";
import type { PackageManifest } from "@12-apps/wiring";

import packageJson from "../../../package.json";
import { onboardingManifest } from "../index";
import { onboardingServerManifest } from "../server";

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about
 * absence has to be made against. Built per case: the flakiness lane refuses
 * shared test-scope bindings.
 */
function declared(): PackageManifest {
  return onboardingManifest;
}

describe("the onboarding manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(onboardingManifest)).toBe(onboardingManifest);
    expect(defineServerManifest(onboardingManifest, onboardingServerManifest)).toBe(
      onboardingServerManifest,
    );
  });

  it("declares the progress surface, the partial and the namespace", () => {
    expect(onboardingManifest.name).toBe("@12-apps/onboarding");
    expect(onboardingManifest.contract).toBe(1);
    expect(onboardingManifest.server).toEqual(["http"]);
    expect(onboardingManifest.db).toEqual({
      partial: "prisma/onboarding.prisma",
      migrations: "prisma/migrations",
    });
    expect(onboardingManifest.observability).toEqual({ namespace: "onboarding" });
  });

  it("declares no web inventory — a server host must not owe an answer for the React half", () => {
    // `./` ships OnboardingProvider and GuidedSection, and `assemble()`
    // refuses a declared-but-unanswered capability: listing `web` here would
    // make every backend adoption red until it bound a surface it never mounts.
    expect(declared().web).toBeUndefined();
  });

  it("declares no env — NODE_ENV is platform vocabulary and reset-ness is a config seam", () => {
    expect(declared().env).toBeUndefined();
  });

  it("mirrors the db declaration and the manifest subpaths into package.json", () => {
    assertDbMirror(onboardingManifest, packageJson);
    assertExportsMirror(onboardingManifest, packageJson);
  });
});
