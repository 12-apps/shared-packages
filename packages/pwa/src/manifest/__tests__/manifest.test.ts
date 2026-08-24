/**
 * The wiring-compliance suite (the report-builder shape): the manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 *
 * The wire view gets BEHAVIOURAL cases beside the declarations, because on
 * this surface the headers ARE the payload — and every one of them is
 * invisible to a type. The root-mount constraint gets its own case for the
 * same reason: `joinRoutePath` is what a host's binding actually does to
 * these paths, so asserting through it is the only way to pin that a `/`
 * mount leaves the browser's two URLs where the browser was told they are.
 */

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";
import { joinRoutePath } from "@12-apps/wiring/consumer";
import type { PackageManifest } from "@12-apps/wiring";

import packageJson from "../../../package.json";
import type { PwaApp, PwaServerConfig } from "../../server";
import { PWA_MOUNT_PATH, pwaManifest } from "../index";
import { createWireApiPwa, pwaServerManifest } from "../server";

/**
 * The manifest as an ADOPTER's type sees it — `as const satisfies` narrows to
 * the literal, on which an absent optional key is a compile error rather than
 * `undefined`. Built per case: the flakiness lane refuses shared test-scope
 * bindings.
 */
function declared(): PackageManifest {
  return pwaManifest;
}

const APP: PwaApp = {
  id: "/acme/",
  name: "Acme",
  startUrl: "/menu",
  scope: "/",
  icons: [],
};

function config(overrides: Partial<PwaServerConfig> = {}): PwaServerConfig {
  return { resolveApp: () => APP, ...overrides };
}

/** The worker is opt-in, so the two-route case has to ask for it. */
function withWorker(): PwaServerConfig {
  return config({ serviceWorker: { cachePrefix: "storefront" } });
}

function get(request: string, headers: Record<string, string> = {}): Request {
  return new Request(request, { headers });
}

describe("the pwa manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(pwaManifest)).toBe(pwaManifest);
    expect(defineServerManifest(pwaManifest, pwaServerManifest)).toBe(pwaServerManifest);
  });

  it("declares the two root-mounted endpoints and the namespace", () => {
    expect(pwaManifest.name).toBe("@12-apps/pwa");
    expect(pwaManifest.contract).toBe(1);
    expect(pwaManifest.server).toEqual(["http"]);
    expect(pwaManifest.observability).toEqual({ namespace: "pwa" });
  });

  it("declares no db, permissions, mcp, env, e2e, web or jobs — see the manifest narrowings", () => {
    expect(declared().db).toBeUndefined();
    expect(declared().permissions).toBeUndefined();
    expect(declared().mcp).toBeUndefined();
    expect(declared().env).toBeUndefined();
    expect(declared().e2e).toBeUndefined();
    expect(declared().web).toBeUndefined();
    expect(pwaServerManifest).not.toHaveProperty("jobs");
  });

  it("mirrors the (absent) db declaration and the manifest subpaths into package.json", () => {
    assertDbMirror(pwaManifest, packageJson);
    assertEnvMirror(pwaManifest, packageJson);
    assertExportsMirror(pwaManifest, packageJson);
  });
});

describe("the root-mount constraint", () => {
  it("leaves both declared paths untouched when bound at the root", () => {
    const api = createWireApiPwa(withWorker());
    expect(api.routes.map((route) => joinRoutePath(PWA_MOUNT_PATH, route.path))).toEqual([
      "/manifest.webmanifest",
      "/sw.js",
    ]);
  });

  it("is what a prefix mount would break — the browser was told the root URLs", () => {
    const api = createWireApiPwa(withWorker());
    // Not an endorsement: this is the failure the constraint names. A worker
    // under a prefix controls only that prefix, and the static `index.html`'s
    // `<link rel="manifest">` is a literal no bind-time prefix can reach.
    expect(api.routes.map((route) => joinRoutePath("/api/pwa", route.path))).toEqual([
      "/api/pwa/manifest.webmanifest",
      "/api/pwa/sw.js",
    ]);
  });

  it("still lets a host move a path through config, which the mount may not do", () => {
    const api = createWireApiPwa(config({ manifestPath: "/api/storefront-manifest" }));
    expect(joinRoutePath(PWA_MOUNT_PATH, api.routes[0]?.path ?? "")).toBe(
      "/api/storefront-manifest",
    );
  });
});

describe("the wire view", () => {
  it("marks the manifest route public and answers the raw half", async () => {
    const api = createWireApiPwa(config());
    const route = api.routes[0];
    if (!route) throw new Error("the manifest route is gone");
    expect(route.kind).toBe("public");

    const answer = await route.handle({
      actor: undefined,
      params: {},
      query: {},
      request: get("https://acme.test/manifest.webmanifest"),
    });

    expect(answer).toHaveProperty("response");
    const { response } = answer as { response: Response };
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    expect(await response.json()).toMatchObject({ id: "/acme/", name: "Acme" });
  });

  it("adds Vary on every answer — one cacheable URL serves every tenant", async () => {
    const api = createWireApiPwa(config({ resolveApp: () => null }));
    const route = api.routes[0];
    if (!route) throw new Error("the manifest route is gone");

    const answer = await route.handle({
      actor: undefined,
      params: {},
      query: {},
      request: get("https://platform.test/manifest.webmanifest"),
    });

    const { response } = answer as { response: Response };
    // The 404 too: a cached "not an app here" keyed on the URL alone would
    // deny every tenant behind the same proxy.
    expect(response.status).toBe(404);
    expect(response.headers.get("vary")).toBe("x-forwarded-host");
    expect(await response.text()).toBe("");
  });

  it("resolves the app from the FORWARDED host first — the proxy topology this ships behind", async () => {
    const seen: string[] = [];
    const api = createWireApiPwa(
      config({
        resolveApp: ({ host }) => {
          seen.push(host);
          return APP;
        },
      }),
    );
    const route = api.routes[0];
    if (!route) throw new Error("the manifest route is gone");

    await route.handle({
      actor: undefined,
      params: {},
      query: {},
      request: get("https://internal.bind/manifest.webmanifest", {
        "x-forwarded-host": "Acme.Example ,other.example",
      }),
    });

    expect(seen).toEqual(["acme.example"]);
  });

  it("refuses a binding whose adapter forwards no raw request", async () => {
    const api = createWireApiPwa(config());
    const route = api.routes[0];
    if (!route) throw new Error("the manifest route is gone");

    await expect(
      route.handle({ actor: undefined, params: {}, query: {} }),
    ).rejects.toThrow(/raw request/);
  });
});
