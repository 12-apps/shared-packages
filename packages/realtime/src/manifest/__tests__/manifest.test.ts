/**
 * The wiring-compliance suite (the report-builder shape): the manifest is a
 * plain `satisfies`-checked value with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it } from "vitest";
import type { WireEnvVar } from "@12-apps/wiring";
import { assertDbMirror, assertEnvMirror, assertExportsMirror, defineManifest } from "@12-apps/wiring/producer";

import packageJson from "../../../package.json";
import { realtimeManifest } from "../index";

/** Read afresh per test — the flakiness lane refuses shared test-scope bindings. */
function declaredEnvOf(): readonly WireEnvVar[] {
  return realtimeManifest.env;
}

describe("the realtime manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(realtimeManifest)).toBe(realtimeManifest);
  });

  it("declares a pure-data manifest: identity and env, no runtime inventory", () => {
    expect(realtimeManifest.name).toBe("@12-apps/realtime");
    expect(realtimeManifest.contract).toBe(1);
    expect(realtimeManifest).not.toHaveProperty("server");
    expect(realtimeManifest).not.toHaveProperty("web");
  });

  it("splits scopes by process: gateway vars ride worker, API vars ride server", () => {
    const byName = new Map(declaredEnvOf().map((declared) => [declared.name, declared]));
    expect(byName.get("REALTIME_GATEWAY_PORT")?.scope).toBe("worker");
    expect(byName.get("REALTIME_GATEWAY_MAX_CONNECTIONS")?.scope).toBe("worker");
    // The API side degrades by design (no secret means no WS transport), so
    // nothing is `required` — the gateway enforces its own boot requirement,
    // which is stricter than any assemble-time check could be.
    expect(declaredEnvOf().some((declared) => declared.required)).toBe(false);
    expect(byName.get("REALTIME_TICKET_SECRET")?.secret).toBe(true);
    // AUTH_SECRET stays undeclared here: it is @12-apps/auth's contribution,
    // and this package only falls back to it.
    expect(byName.has("AUTH_SECRET")).toBe(false);
  });

  it("mirrors env into package.json, and the exports map matches the declarations", () => {
    expect(() => assertDbMirror(realtimeManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(realtimeManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(realtimeManifest, packageJson)).not.toThrow();
  });
});
