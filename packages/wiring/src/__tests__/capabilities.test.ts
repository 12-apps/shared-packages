/**
 * The 1.3.0 capabilities: route policy, env, observability, the e2e world
 * answer, and the jobs blueprint extensions — producer assertions and
 * consumer postures in one place, since every case here crosses both halves.
 */

import { describe, expect, it } from "vitest";

import { createWiringHost, routePolicyTable } from "../consumer";
import { WiringAssemblyError, WiringDefinitionError } from "../errors";
import { memoryLogger } from "../ports";
import { assertEnvMirror, defineManifest, defineServerManifest } from "../producer";
import type { PackageManifest } from "../contract/manifest";
import type { WireResponse } from "../contract/http";

const ok = (): Promise<WireResponse> => Promise.resolve({ status: 200, body: null });
const base = { name: "@12-apps/example", contract: 1 as const };

function serverHostAdopting(
  manifest: PackageManifest,
  routes: readonly Record<string, unknown>[],
  extras: Record<string, unknown> = {},
) {
  const binder = createWiringHost({
    name: "api",
    kind: "server",
    ...(extras["ports"] === undefined ? {} : { ports: extras["ports"] as never }),
  });
  binder.adoptServer({
    manifest,
    server: { name: manifest.name, http: { create: () => ({ routes: routes as never }) } },
    bindings: { http: { mountPath: "/api/admin/:tenantSlug", config: undefined as never } },
    observability: { declined: "route policy is the subject here" },
    ...extras,
  } as never);
  return binder;
}

describe("route policy", () => {
  const withPermissions = defineManifest({
    ...base,
    permissions: {
      source: "x",
      ids: ["notes:manage"],
      permissions: { "notes:manage": { kind: "class" } },
    },
    server: ["http"],
    observability: { namespace: "notes" },
  });

  it("flattens kind, permission, entitlement and quota into the policy table", () => {
    const adopted = serverHostAdopting(withPermissions, [
      { method: "GET", path: "/notes", handle: ok },
      { method: "POST", path: "/notes", permission: "notes:manage", quota: "notes.saved", handle: ok },
      { method: "POST", path: "/hooks/pix", kind: "webhook", handle: ok },
    ]);
    const rows = routePolicyTable(adopted.assemble().routes);
    const byKey = new Map(rows.map((row) => [`${row.method} ${row.path}`, row]));
    expect(byKey.get("GET /api/admin/:tenantSlug/notes")?.kind).toBe("authenticated");
    expect(byKey.get("POST /api/admin/:tenantSlug/notes")?.permission).toBe("notes:manage");
    expect(byKey.get("POST /api/admin/:tenantSlug/notes")?.quota).toBe("notes.saved");
    expect(byKey.get("POST /api/admin/:tenantSlug/hooks/pix")?.kind).toBe("webhook");
  });

  it("refuses a permission on an unauthenticated route, and an entitlement on a webhook", () => {
    expect(() =>
      serverHostAdopting(withPermissions, [
        { method: "POST", path: "/hooks/pix", kind: "webhook", permission: "notes:manage", handle: ok },
      ]),
    ).toThrow(/no actor to check/);
    expect(() =>
      serverHostAdopting(withPermissions, [
        { method: "POST", path: "/hooks/pix", kind: "webhook", entitlement: "notes.pix", handle: ok },
      ]),
    ).toThrow(/drops events/);
  });

  it("refuses a permission the package's own contribution does not declare", () => {
    expect(() =>
      serverHostAdopting(withPermissions, [
        { method: "POST", path: "/notes", permission: "notes:publish", handle: ok },
      ]),
    ).toThrow(/does not declare/);
  });
});

describe("the env capability", () => {
  const withEnv = defineManifest({
    ...base,
    env: [
      { name: "NOTES_SIGNING_KEY", required: true, secret: true },
      { name: "NOTES_DEBUG" },
      { name: "NOTES_WEB_SENTRY", scope: "web" },
    ],
  });

  it("producer refuses duplicate and non-UPPER_SNAKE names", () => {
    expect(() =>
      defineManifest({ ...base, env: [{ name: "A_B" }, { name: "A_B" }] }),
    ).toThrow(/duplicate env var name/);
    expect(() => defineManifest({ ...base, env: [{ name: "lower" }] })).toThrow(
      /not UPPER_SNAKE/,
    );
  });

  it("binds when required vars are set, reports names-only when they are not", () => {
    const bound = createWiringHost({ name: "api", kind: "server" });
    bound.adoptServer({ manifest: withEnv, env: { NOTES_SIGNING_KEY: "s3cret" } });
    const assembled = bound.assemble();
    const entry = assembled.report.packages[0]?.capabilities.find((c) => c.kind === "env");
    expect(entry?.status).toBe("bound");
    expect(entry?.detail).toBe("1/2 vars set");
    expect(assembled.env[0]?.vars.map((declared) => declared.name)).toContain("NOTES_WEB_SENTRY");

    const missing = createWiringHost({ name: "api", kind: "server" });
    missing.adoptServer({ manifest: withEnv, env: { NOTES_SIGNING_KEY: "" } });
    expect(() => missing.assemble()).toThrow(/required env unset: NOTES_SIGNING_KEY/);
    try {
      missing.assemble();
    } catch (error) {
      expect((error as WiringAssemblyError).message).not.toContain("s3cret");
    }
  });

  it("is unbound with no answer, declinable in writing, out-of-scope across runtimes", () => {
    const unanswered = createWiringHost({ name: "api", kind: "server" });
    unanswered.adoptServer({ manifest: withEnv });
    expect(() => unanswered.assemble()).toThrow(/env/);

    const declined = createWiringHost({ name: "api", kind: "server" });
    declined.adoptServer({ manifest: withEnv, env: { declined: "config comes from the vault, not process.env" } });
    expect(declined.assemble().report.packages[0]?.capabilities.find((c) => c.kind === "env")?.status).toBe("declined");

    const web = createWiringHost({ name: "spa", kind: "web" });
    web.adoptWeb({
      manifest: defineManifest({ ...base, env: [{ name: "ONLY_SERVER", scope: "server" }] }),
    });
    expect(web.assemble().report.packages[0]?.capabilities.find((c) => c.kind === "env")?.status).toBe(
      "out-of-scope",
    );
  });
});

describe("the observability capability", () => {
  const withNamespace = defineManifest({ ...base, observability: { namespace: "notes" } });

  it("producer refuses a namespace that is not lowercase-dash", () => {
    expect(() => defineManifest({ ...base, observability: { namespace: "Notes!" } })).toThrow(
      WiringDefinitionError,
    );
  });

  it("builds a namespaced logger through loggerFor, or prefixes the shared logger", () => {
    const seen: string[] = [];
    const viaFactory = createWiringHost({
      name: "api",
      kind: "server",
      ports: { loggerFor: (namespace) => ({ info: (m) => void seen.push(`${namespace}:${m}`), warn: () => {}, error: () => {} }) },
    });
    viaFactory.adoptServer({ manifest: withNamespace });
    viaFactory.assemble().loggers[base.name]?.info("saved");
    expect(seen).toEqual(["notes:saved"]);

    const shared = memoryLogger();
    const viaPrefix = createWiringHost({ name: "api", kind: "server", ports: { logger: shared.port } });
    viaPrefix.adoptServer({ manifest: withNamespace });
    viaPrefix.assemble().loggers[base.name]?.error("boom");
    expect(shared.lines).toEqual(["error [notes] boom"]);
  });

  it("is unbound with no logger port, and declinable", () => {
    const bare = createWiringHost({ name: "api", kind: "server" });
    bare.adoptServer({ manifest: withNamespace });
    expect(() => bare.assemble()).toThrow(/loggerFor/);

    const declined = createWiringHost({ name: "api", kind: "server" });
    declined.adoptServer({ manifest: withNamespace, observability: { declined: "this host has no telemetry sink" } });
    expect(declined.assemble().loggers[base.name]).toBeUndefined();
  });
});

describe("the e2e world answer", () => {
  const withWorld = defineManifest({
    ...base,
    e2e: { entry: "@12-apps/example/e2e", world: { factory: "defineExampleWorld" } },
  });

  it("stays a collected pointer when no world is declared", () => {
    const collectedOnly = createWiringHost({ name: "api", kind: "server" });
    collectedOnly.adoptServer({ manifest: defineManifest({ ...base, e2e: { entry: "@12-apps/example/e2e" } }) });
    expect(collectedOnly.assemble().report.packages[0]?.capabilities.find((c) => c.kind === "e2e")?.status).toBe(
      "collected",
    );
  });

  it("a declared world must be bound with a featuresRoot or declined — silence is refused", () => {
    const silent = createWiringHost({ name: "api", kind: "server" });
    silent.adoptServer({ manifest: withWorld });
    expect(() => silent.assemble()).toThrow(/defineExampleWorld/);

    const blank = createWiringHost({ name: "api", kind: "server" });
    blank.adoptServer({ manifest: withWorld, e2e: { featuresRoot: " " } });
    expect(() => blank.assemble()).toThrow(/node_modules/);

    const bound = createWiringHost({ name: "api", kind: "server" });
    bound.adoptServer({ manifest: withWorld, e2e: { featuresRoot: ".features-gen/example" } });
    const entry = bound.assemble().report.packages[0]?.capabilities.find((c) => c.kind === "e2e");
    expect(entry?.status).toBe("bound");
    expect(entry?.detail).toContain(".features-gen/example");

    const declined = createWiringHost({ name: "api", kind: "server" });
    declined.adoptServer({ manifest: withWorld, e2e: { declined: "journeys run from this repo's own bdd config" } });
    expect(declined.assemble().report.packages[0]?.capabilities.find((c) => c.kind === "e2e")?.status).toBe(
      "declined",
    );
  });
});

describe("jobs blueprint extensions", () => {
  const shared = defineManifest({ ...base, server: ["jobs"], observability: { namespace: "notes" } });

  it("producer refuses both cadences at once and non-positive interval/lease", () => {
    const blueprint = { name: "drain", handle: () => Promise.resolve() };
    expect(() =>
      defineServerManifest(shared, {
        name: base.name,
        jobs: {
          namespace: "notes",
          blueprints: {
            drain: { ...blueprint, schedule: { pattern: "* * * * *" }, interval: { everyMs: 10_000 } },
          },
        },
      }),
    ).toThrow(/pick one cadence/);
    expect(() =>
      defineServerManifest(shared, {
        name: base.name,
        jobs: { namespace: "notes", blueprints: { drain: { ...blueprint, interval: { everyMs: 0 } } } },
      }),
    ).toThrow(/non-positive interval/);
    expect(() =>
      defineServerManifest(shared, {
        name: base.name,
        jobs: { namespace: "notes", blueprints: { drain: { ...blueprint, lease: { ttlMs: -1 } } } },
      }),
    ).toThrow(/non-positive lease/);
  });

  it("interval and lease survive binding onto the BoundJob", () => {
    const runtime = createWiringHost({ name: "api", kind: "server" });
    runtime.adoptServer({
      manifest: shared,
      observability: { declined: "the jobs shapes are the subject here" },
      server: {
        name: base.name,
        jobs: {
          namespace: "notes",
          blueprints: {
            drain: {
              name: "drain",
              interval: { everyMs: 10_000 },
              lease: { ttlMs: 30_000 },
              handle: () => Promise.resolve(),
            },
          },
        },
      },
      bindings: { jobs: { deps: undefined as never } },
    });
    const job = runtime.assemble().jobs[0];
    expect(job?.name).toBe("notes.drain");
    expect(job?.interval?.everyMs).toBe(10_000);
    expect(job?.lease?.ttlMs).toBe(30_000);
  });
});

describe("assertEnvMirror", () => {
  const declared = defineManifest({ ...base, env: [{ name: "NOTES_KEY", required: true }] });

  it("passes a matching mirror whatever the key order, refuses drift and absence both ways", () => {
    expect(() =>
      assertEnvMirror(declared, { name: base.name, wiring: { env: [{ required: true, name: "NOTES_KEY" }] } }),
    ).not.toThrow();
    expect(() => assertEnvMirror(declared, { name: base.name })).toThrow(/must be mirrored/);
    expect(() =>
      assertEnvMirror(declared, { name: base.name, wiring: { env: [{ name: "OTHER" }] } }),
    ).toThrow(/drifted/);
    expect(() =>
      assertEnvMirror(defineManifest(base), { name: base.name, wiring: { env: [] } }),
    ).toThrow(/declares no env capability/);
    expect(() => assertEnvMirror(defineManifest(base), { name: base.name })).not.toThrow();
  });
});
