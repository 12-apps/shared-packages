/**
 * The wiring-compliance suite (the report-builder shape): the manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 *
 * The wire view gets BEHAVIOURAL cases beside the declarations, because it is
 * the one place this manifest is more than data — it carries a Fetch
 * `Response` across a contract whose default answer shape cannot express one,
 * and the failure it prevents (a 302 serialized into a body, a JWKS losing
 * its cache header) type-checks perfectly.
 */

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";
import type { PackageManifest, WireRequest } from "@12-apps/wiring";

import packageJson from "../../../package.json";
import { DEFAULT_OAUTH_PATHS, type McpOauthConfig, type McpOauthStores } from "../../oauth";
import { mcpManifest } from "../index";
import { createWireApiMcpOauth, mcpServerManifest } from "../server";

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about absence
 * has to be made against. Built per case: the flakiness lane refuses shared
 * test-scope bindings.
 */
function declared(): PackageManifest {
  return mcpManifest;
}

/** Stores that answer nothing — no case below reaches one. */
function emptyStores(): McpOauthStores {
  return {
    clients: {
      findByClientId: () => Promise.resolve(null),
      create: () => Promise.reject(new Error("unused")),
    },
    refreshTokens: {
      findByHash: () => Promise.resolve(null),
      create: () => Promise.reject(new Error("unused")),
      revoke: () => Promise.resolve(),
      revokeLineage: () => Promise.resolve(),
    },
  } as unknown as McpOauthStores;
}

function config(overrides: Partial<McpOauthConfig> = {}): McpOauthConfig {
  return {
    stores: emptyStores(),
    resolveSession: () => Promise.resolve(null),
    signingKey: () => Promise.resolve(null),
    // Required with no default, deliberately (see `McpOauthConfig`): the
    // single-instance limitation has to be typed out rather than inherited.
    codeReplay: "in-process",
    ...overrides,
  } as McpOauthConfig;
}

describe("the mcp manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(mcpManifest)).toBe(mcpManifest);
    expect(defineServerManifest(mcpManifest, mcpServerManifest)).toBe(mcpServerManifest);
  });

  it("declares the authorization server, the three-model partial and the namespace", () => {
    expect(mcpManifest.name).toBe("@12-apps/mcp");
    expect(mcpManifest.contract).toBe(1);
    expect(mcpManifest.server).toEqual(["http"]);
    expect(mcpManifest.db).toEqual({
      partial: "prisma/mcp.prisma",
      migrations: "prisma/migrations",
    });
    expect(mcpManifest.observability).toEqual({ namespace: "mcp" });
  });

  it("declares the partial as COMPOSED — adopters relate these rows into their own user table", () => {
    // `mode` absent IS composed. Isolation would need models no host relates
    // into its own tables, and the origin host's migration adds an
    // `ON DELETE CASCADE` FK onto `user_id`.
    expect(declared().db).not.toHaveProperty("mode");
  });

  it("declares no mcp tools and no permissions — it IS the runtime, and auth is passthrough", () => {
    expect(declared().mcp).toBeUndefined();
    expect(declared().permissions).toBeUndefined();
  });

  it("declares no web inventory — ./react ships components, not a bound surface factory", () => {
    expect(declared().web).toBeUndefined();
  });

  it("declares no env and no jobs — see the manifest's own narrowings", () => {
    expect(declared().env).toBeUndefined();
    expect(mcpServerManifest).not.toHaveProperty("jobs");
    expect(mcpServerManifest).not.toHaveProperty("email");
  });

  /**
   * `e2e` used to be narrowed away here beside `env` and `jobs`, on the
   * circular ground that "this package packages no journeys" — true only
   * because none had been written, while `./react` shipped a whole walkthrough
   * no suite in either repo touched. It is a DECLARATION now, and this asserts
   * the two halves a host actually consumes: the entry it imports, and the
   * factory name it calls to install its world.
   */
  it("declares e2e, pointing at the entry a host imports and the world it installs", () => {
    expect(declared().e2e).toEqual({
      entry: "@12-apps/mcp/e2e",
      world: { factory: "defineMcpConnectWorld" },
    });
    // The declaration is only true if the subpath resolves — an entry naming a
    // export the package does not carry is the exports tripwire's whole point.
    expect(packageJson.exports).toHaveProperty(["./e2e"]);
  });

  /**
   * The `env` narrowing, made falsifiable.
   *
   * It used to claim "the package reads nothing itself", which was untrue —
   * an unfalsifiable sentence is exactly how a narrowing rots. The corrected
   * claim is narrower and checkable: the ONLY `process.env` reads in shipped
   * source sit inside the three named helpers, and none runs at import time.
   * A fourth read, or one at module scope, breaks this — which is the point.
   */
  it("reads process.env only inside the named helpers, and never at import time", () => {
    /* eslint-disable test-flakiness/no-unmocked-fs -- the real source tree IS
       the subject: the claim is about which shipped files read process.env,
       and a mocked fs would let the file the claim is about go unread. */
    const dir = new URL("../../", import.meta.url).pathname;
    // Path → comment-stripped source, kept from the ONE walk so the
    // module-scope check below re-reads nothing: a second pass over the same
    // files could disagree with the first, and would be a second unmocked read
    // to justify for no benefit.
    const offenders = new Map<string, string>();
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = `${at}${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(`${full}/`);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        // Comments are stripped first: the narrowing's own explanation names
        // `process.env` in prose, and prose is not a read.
        const code = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (code.includes("process.env")) offenders.set(full.slice(dir.length), code);
      }
    };
    walk(dir);
    /* eslint-enable test-flakiness/no-unmocked-fs */

    // Exactly the two files the narrowing names, and nothing else.
    expect([...offenders.keys()].sort()).toEqual(["oauth/config.ts", "oauth/keys.ts"]);

    // …and every read is inside a function body, so importing the package
    // touches no environment. A module-scope read would make the narrowing
    // false again in the one way the file list above cannot see.
    for (const code of offenders.values()) {
      for (const line of code.split("\n")) {
        if (!line.includes("process.env")) continue;
        expect(line.startsWith(" ") || line.startsWith("\t")).toBe(true);
      }
    }
  });

  it("mirrors the db declaration and the manifest subpaths into package.json", () => {
    assertDbMirror(mcpManifest, packageJson);
    assertEnvMirror(mcpManifest, packageJson);
    assertExportsMirror(mcpManifest, packageJson);
  });
});

describe("the wire view", () => {
  it("re-shapes every descriptor without moving a path — the mount is the origin root", () => {
    const api = createWireApiMcpOauth(config());
    expect(api.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      `GET ${DEFAULT_OAUTH_PATHS.authorizationServerMetadata}`,
      `GET ${DEFAULT_OAUTH_PATHS.protectedResourceMetadata}`,
      `GET ${DEFAULT_OAUTH_PATHS.jwks}`,
      `GET ${DEFAULT_OAUTH_PATHS.authorize}`,
      `POST ${DEFAULT_OAUTH_PATHS.token}`,
      `POST ${DEFAULT_OAUTH_PATHS.register}`,
    ]);
  });

  it("marks every route public — these six ARE the authentication", () => {
    const api = createWireApiMcpOauth(config());
    expect(api.routes.every((route) => route.kind === "public")).toBe(true);
    // The contract forbids a permission on a non-authenticated route; nothing
    // here carries one, which is what makes that legal.
    expect(api.routes.every((route) => !("permission" in route))).toBe(true);
  });

  it("keeps the rest of the surface beside the routes — handlers, verifyBearer, context", () => {
    const api = createWireApiMcpOauth(config());
    expect(typeof api.handlers.token).toBe("function");
    expect(typeof api.verifyBearer).toBe("function");
    expect(api.context.paths).toEqual(DEFAULT_OAUTH_PATHS);
  });

  it("answers the RAW half, headers intact — a JWKS 503 is a Response, not a serialized body", async () => {
    const api = createWireApiMcpOauth(config());
    const jwks = api.routes.find((route) => route.path === DEFAULT_OAUTH_PATHS.jwks);
    if (!jwks) throw new Error("the jwks route is gone");

    const answer = await jwks.handle({
      actor: undefined,
      params: {},
      query: {},
      request: new Request(`https://host.test${DEFAULT_OAUTH_PATHS.jwks}`),
    });

    expect(answer).toHaveProperty("response");
    const { response } = answer as { response: Response };
    // Unprovisioned AS: 503 rather than an empty key set — and the status
    // survives the crossing, which `{ status, body }` could also have done.
    expect(response.status).toBe(503);
    // This is the half it could NOT have done.
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("refuses a binding whose adapter forwards no raw request", async () => {
    const api = createWireApiMcpOauth(config());
    const token = api.routes.find((route) => route.path === DEFAULT_OAUTH_PATHS.token);
    if (!token) throw new Error("the token route is gone");

    const request: WireRequest = { actor: undefined, params: {}, query: {} };
    await expect(token.handle(request)).rejects.toThrow(/raw request/);
  });
});
