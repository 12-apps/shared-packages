/**
 * The wiring-compliance suite (the report-builder shape). The manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE — the
 * same "fails in the package's own test run" guarantee with zero runtime
 * dependencies added.
 */

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";

import packageJson from "../../../package.json";
import { createApiBilling } from "../../server/routes";
import { billingManifest } from "../index";
import { billingServerManifest } from "../server";

describe("the shared manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(billingManifest)).toBe(billingManifest);
    expect(defineServerManifest(billingManifest, billingServerManifest)).toBe(billingServerManifest);
  });

  it("declares the package identity and the runtime inventory", () => {
    expect(billingManifest.name).toBe("@12-apps/billing");
    expect(billingManifest.contract).toBe(1);
    expect(billingManifest.server).toEqual(["http"]);
    // Mandatory for runtime manifests — the namespace the binder scopes a
    // logger to. The money path is the one place where "it failed and filed
    // nowhere" is unaffordable.
    expect(billingManifest.observability).toEqual({ namespace: "billing" });
  });

  it("declares no web half at all", () => {
    // There is no packaged screen: the card form is the provider's SDK in the
    // host's own page, and everything else here is server work.
    expect(billingManifest).not.toHaveProperty("web");
  });

  it("declares NO db contribution — every model still points at a host table", () => {
    // Subscriptions, cycles and stored instruments all carry foreign keys into
    // the host's own account table, and a package partial cannot declare a
    // relation into a table it does not own. The schema stays the host's and
    // reaches this package through the `./server` ports.
    expect(billingManifest).not.toHaveProperty("db");
    expect(() => assertDbMirror(billingManifest, packageJson)).not.toThrow();
  });

  it("declares NO permissions, notifications or mcp contribution — each absence is the design", () => {
    // Who may put a card on file is a ROLE decision the host makes; the one
    // notice this domain sends is entirely host copy; and a surface that
    // writes a payment instrument stays in a browser behind a human.
    expect(billingManifest).not.toHaveProperty("permissions");
    expect(billingManifest).not.toHaveProperty("notifications");
    expect(billingManifest).not.toHaveProperty("mcp");
  });

  it("reads no environment variable anywhere in shipped source", () => {
    // Every number, table and sentence arrives as config. A package that read
    // its own env would be a second place a deployment is configured.
    expect(billingManifest).not.toHaveProperty("env");
    expect(() => assertEnvMirror(billingManifest, packageJson)).not.toThrow();
  });

  it("keeps exports subpaths and manifest declarations the same set", () => {
    // A capability shipped as an exports subpath the manifest never mentions
    // is invisible to the adopting host; the reverse is a declaration whose
    // module no longer resolves. Both directions fail this package's own run.
    expect(() => assertExportsMirror(billingManifest, packageJson)).not.toThrow();
  });
});

describe("the server manifest", () => {
  it("hands the host the factory itself, not a copy of it", () => {
    expect(billingServerManifest.http.create).toBe(createApiBilling);
  });

  it("is named the same as its shared half", () => {
    expect(billingServerManifest.name).toBe(billingManifest.name);
  });
});
