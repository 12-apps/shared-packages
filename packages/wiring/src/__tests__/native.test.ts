import { describe, expect, it } from "vitest";

import { createWiringHost } from "../consumer";
import { envScopesOf } from "../contract/env";
import { WiringAssemblyError, WiringDefinitionError } from "../errors";
import { defineManifest, defineNativeManifest, defineWebManifest } from "../producer";

/**
 * The NATIVE runtime (React Native hosts): a package ships its screens for a
 * native app behind `<pkg>/manifest/native`, inventoried like the web half,
 * and a `native` host adopts it with the same build-once, answer-or-decline
 * discipline. The surface is the web surface's twin in shape; the runtimes
 * stay apart because neither bundle may import the other's UI.
 */

interface ThreadSurface {
  ThreadScreen: () => string;
}

const shared = defineManifest({
  name: "@12-apps/example-thread",
  contract: 1,
  observability: { namespace: "example-thread" },
  web: ["surface"],
  native: ["surface"],
  env: [{ name: "EXAMPLE_NATIVE_FLAG", scope: "native", required: true }],
});

const web = defineWebManifest(shared, {
  name: shared.name,
  surface: { create: (config: { apiBase: string }): ThreadSurface => ({ ThreadScreen: () => `web@${config.apiBase}` }) },
});

const native = defineNativeManifest(shared, {
  name: shared.name,
  surface: { create: (config: { apiBase: string }): ThreadSurface => ({ ThreadScreen: () => `native@${config.apiBase}` }) },
});

const observed = { observability: { declined: "covered by the capabilities suite" } } as const;

describe("defineNativeManifest", () => {
  it("returns a manifest that matches its shared inventory", () => {
    expect(native.surface?.create({ apiBase: "/api" }).ThreadScreen()).toBe("native@/api");
  });

  it("refuses a name that is not the shared manifest's", () => {
    expect(() => defineNativeManifest(shared, { name: "@12-apps/other" })).toThrow(WiringDefinitionError);
  });

  it("refuses a surface the shared inventory does not list, and a listed one that is missing", () => {
    const webOnly = defineManifest({
      name: "@12-apps/web-only",
      contract: 1,
      web: ["surface"],
      observability: { namespace: "web-only" },
    });
    expect(() =>
      defineNativeManifest(webOnly, { name: webOnly.name, surface: { create: () => ({}) } }),
    ).toThrow(/native manifest declares "surface" but the shared inventory omits it/);
    expect(() => defineNativeManifest(shared, { name: shared.name })).toThrow(
      /shared inventory lists "surface" but the native manifest omits it/,
    );
  });

  it("refuses a native inventory that names a kind twice", () => {
    expect(() =>
      defineManifest({
        name: "@12-apps/twice",
        contract: 1,
        native: ["surface", "surface"],
        observability: { namespace: "twice" },
      }),
    ).toThrow(/native inventory entry/);
  });
});

describe("a native host", () => {
  it("builds the native surface once and leaves the web half to a web host", () => {
    const host = createWiringHost({ name: "courier-app", kind: "native" });
    const { surface } = host.adoptNative({
      manifest: shared,
      native,
      ...observed,
      env: { EXAMPLE_NATIVE_FLAG: "1" },
      bindings: { surface: { config: { apiBase: "https://api.example" } } },
    });
    expect(surface.ThreadScreen()).toBe("native@https://api.example");
    const assembled = host.assemble();
    expect(assembled.surfaces[shared.name]).toBe(surface);
    expect(assembled.report.kind).toBe("native");
    const entries = assembled.report.packages[0]?.capabilities ?? [];
    expect(entries.filter((entry) => entry.kind === "surface")).toEqual([
      { kind: "surface", status: "bound", detail: "surface built once for this host" },
      { kind: "surface", status: "out-of-scope", detail: "a web host answers for this" },
    ]);
  });

  it("refuses to assemble while the native surface is unanswered, and accepts a written decline", () => {
    const unbound = createWiringHost({ name: "courier-app", kind: "native" });
    unbound.adoptNative({ manifest: shared, native, ...observed, env: { EXAMPLE_NATIVE_FLAG: "1" } });
    expect(() => unbound.assemble()).toThrow(/@12-apps\/example-thread → surface/);

    const declined = createWiringHost({ name: "courier-app", kind: "native" });
    declined.adoptNative({
      manifest: shared,
      native,
      ...observed,
      env: { EXAMPLE_NATIVE_FLAG: "1" },
      bindings: { surface: { declined: "this app shows no threads yet" } },
    });
    expect(declined.assemble().surfaces[shared.name]).toBeUndefined();
  });

  it("answers the native-scoped environment, and only there", () => {
    expect(envScopesOf("native")).toEqual(["native"]);
    const host = createWiringHost({ name: "courier-app", kind: "native" });
    host.adoptNative({
      manifest: shared,
      native,
      ...observed,
      bindings: { surface: { config: { apiBase: "/api" } } },
    });
    expect(() => host.assemble()).toThrow(/env/);

    const webHost = createWiringHost({ name: "storefront", kind: "web" });
    webHost.adoptWeb({ manifest: shared, web, ...observed, bindings: { surface: { config: { apiBase: "/api" } } } });
    const env = webHost.assemble().report.packages[0]?.capabilities.find((entry) => entry.kind === "env");
    expect(env?.status).toBe("out-of-scope");
  });

  it("names the right adopt method when a package is handed to the wrong host", () => {
    const nativeHost = createWiringHost({ name: "courier-app", kind: "native" });
    expect(() => nativeHost.adoptWeb({ manifest: shared })).toThrow(/native host — use adoptNative/);
    const webHost = createWiringHost({ name: "storefront", kind: "web" });
    expect(() => webHost.adoptNative({ manifest: shared })).toThrow(/web host — use adoptWeb/);
    const serverHost = createWiringHost({ name: "api", kind: "server" });
    expect(() => serverHost.adoptNative({ manifest: shared })).toThrow(WiringAssemblyError);
  });
});

describe("a web host", () => {
  it("reports the native surface as another host's business", () => {
    const host = createWiringHost({ name: "storefront", kind: "web" });
    host.adoptWeb({ manifest: shared, web, ...observed, bindings: { surface: { config: { apiBase: "/api" } } } });
    const entries = host.assemble().report.packages[0]?.capabilities ?? [];
    expect(entries).toContainEqual({ kind: "surface", status: "out-of-scope", detail: "a native host answers for this" });
  });
});
