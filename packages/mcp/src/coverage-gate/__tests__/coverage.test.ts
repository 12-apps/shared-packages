/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the subject:
   this gate exists to walk a host's `app` folder, so the cases build a small real
   tree in a fresh temp dir per test and point the gate at it. Mocking `fs` would
   leave the walk — the part that has historically been wrong — untested. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportedMethodsOf, runMcpCoverage } from "../index";

/**
 * The `mcp:coverage` gate (12-23) — the port of the origin host's
 * `apps/web/scripts/mcp/coverage.ts`, whose contract is a COMPLETENESS property:
 * every served endpoint is registered on the agent surface or explicitly excepted,
 * and every advertised tool maps back to a route that serves it.
 *
 * The scan root is the whole `app` folder on purpose — three OAuth/JWKS discovery
 * routes shipped unregistered for exactly as long as the walk was rooted at
 * `app/api`, and a completeness gate that never looks does not fail.
 */

let root: string;
let appDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-coverage-"));
  appDir = join(root, "app");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a route file at an app-relative path, e.g. `api/orders`. */
function route(urlDir: string, source: string): void {
  const file = join(appDir, urlDir, "route.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function actions(urlDir: string, source: string): void {
  const file = join(appDir, urlDir, "actions.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

function json(name: string, body: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

const NO_EXCLUSIONS = { actions: {}, routes: {} };

describe("exportedMethodsOf", () => {
  it("sees every form a route file exports a handler in", () => {
    expect(exportedMethodsOf("export const GET = handler;")).toEqual(["GET"]);
    expect(exportedMethodsOf("export async function POST(req) {}")).toEqual(["POST"]);
    // A SYNC `export function` — the `syncFunctions` grammar knob. A server action
    // cannot take this form (it must be async), which is the whole reason the
    // shared walk is parameterized rather than forked.
    expect(exportedMethodsOf("export function PUT(req) {}")).toEqual(["PUT"]);
    expect(exportedMethodsOf("export const { GET, POST } = handlers;").sort()).toEqual([
      "GET",
      "POST",
    ]);
    expect(exportedMethodsOf("export { handler as DELETE };")).toEqual(["DELETE"]);
    // A type is never a handler.
    expect(exportedMethodsOf("export type { GET } from './x';")).toEqual([]);
  });

  it(
    "stays linear on adversarial input (CodeQL js/polynomial-redos)",
    { timeout: 5_000 },
    () => {
      // ONE fixture, because only one of the three this case used to carry actually
      // cost anything. Measured against the pre-fix regex pair: 150k spaces took
      // 1ms and 60k `export {` openers followed by `GET}` took 2ms — ~360KB of
      // fixture carrying no ReDoS signal at all — while the shape below took
      // 15,398ms. The pathological family is MANY UNCLOSED OPENERS: every `export {`
      // restarted a match whose `[^}]+` ran to end-of-file, so the cost was
      // quadratic in the OPENER COUNT, not in file length. 20k openers: 1,647ms.
      // 60k: 15,424ms — 9.4x for 3x the input, which is the quadratic signature.
      // The shared linear walk does the same fixture in 69ms.
      //
      // What makes this FAIL pre-fix is therefore the 5s bound alone, and that is
      // the honest reason: the expectation below is the answer BOTH implementations
      // give, so nothing here can pass by accident on a semantic difference. (An
      // earlier version asserted `["DELETE","GET"]`, which is only the new walk's
      // answer — the case failed pre-fix on that assertion rather than on time,
      // while its comment claimed otherwise.) vitest does fail a synchronous
      // overrun: it reports the timeout once the body returns, which is verified
      // behaviour, not an assumption. The bound is pinned on the case rather than
      // inherited from the suite default so that raising the default cannot quietly
      // neuter it.
      const source = [
        `export {{${"export {{|".repeat(60_000)}`,
        "export const DELETE = h;",
      ].join("\n");

      expect(exportedMethodsOf(source)).toEqual(["DELETE"]);
    },
  );

  it("still sees a list whose COMMENT mentions export (the fail-open one)", () => {
    // A brace list may legally carry a comment, and the linearity skip asks "does
    // another `export` keyword sit inside this list?" — so before comments were
    // blanked, a comment saying the word `export` made the walk abandon the whole
    // list. That direction is fail-OPEN for this gate, not fail-closed: a method the
    // scan misses is simply absent from `covered`, so NO `unregistered route`
    // violation is raised and the route ships unregistered.
    expect(exportedMethodsOf("export {  // re-export the handlers\n  config, GET };")).toEqual([
      "GET",
    ]);
    expect(
      exportedMethodsOf("export { /* export these two */ POST, DELETE };").sort(),
    ).toEqual(["DELETE", "POST"]);
    // Blanking also removes a false positive that used to run the other way: a
    // method named only inside a comment or a string is not a handler.
    expect(exportedMethodsOf("/* export { GET } */ export const POST = h;")).toEqual(["POST"]);
    expect(exportedMethodsOf('const sql = "export { GET }";')).toEqual([]);
  });

  it("survives the shapes a scanner gets wrong where a regex did not", () => {
    // The brace list is found by scanning rather than by an unbounded `[^}]+`
    // regex (which was quadratic on adversarial input); these are the cases that
    // distinguish the two.
    expect(exportedMethodsOf("export   const   {\n  GET,\n  POST,\n} = handlers;").sort()).toEqual([
      "GET",
      "POST",
    ]);
    // A destructuring RENAME binds the local name, so nothing named GET is
    // exported — "the last identifier" is right in both directions.
    expect(exportedMethodsOf("export const { GET: handler } = handlers;")).toEqual([]);
    // Neither a lowercase near-miss nor a word that merely contains a method name.
    expect(exportedMethodsOf("export { get, POSTAL };")).toEqual([]);
    // An unterminated list is not a handler list — and must not throw.
    expect(exportedMethodsOf("export { GET")).toEqual([]);
    // The word `export` elsewhere must not swallow the real one after it.
    expect(
      exportedMethodsOf("// exported earlier\nexport default h;\nexport { handler as PUT };"),
    ).toEqual(["PUT"]);
    // Several lists in one file, each read on its own.
    expect(
      exportedMethodsOf("export { handler as GET };\nexport { other as DELETE };").sort(),
    ).toEqual(["DELETE", "GET"]);
  });
});

describe("route coverage", () => {
  it("passes when every served method is registered", () => {
    route("api/orders", "export const GET = h;\nexport const POST = h;");
    const result = runMcpCoverage({
      appDir,
      endpoints: [
        { method: "get", path: "/api/orders", operationId: "listOrders" },
        { method: "POST", path: "/api/orders", operationId: "createOrder" },
      ],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
    });
    expect(result.failures).toEqual([]);
    expect(result.routeMethodCount).toBe(2);
  });

  it("fails a served method nothing registers", () => {
    route("api/orders", "export const GET = h;\nexport const DELETE = h;");
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [{ method: "GET", path: "/api/orders", operationId: "listOrders" }],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("unregistered route: DELETE /api/orders");
  });

  it("looks outside `app/api`, where the discovery routes live", () => {
    // The regression this gate carries: `.well-known` routes are served by the same
    // framework and were invisible while the walk started at `app/api`.
    route(".well-known/jwks.json", "export const GET = h;");
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
    });
    expect(failures[0]).toContain("unregistered route: GET /.well-known/jwks.json");
  });

  it("fails a registry entry no route serves", () => {
    route("api/orders", "export const GET = h;");
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [
        { method: "GET", path: "/api/orders", operationId: "listOrders" },
        { method: "GET", path: "/api/ghosts", operationId: "listGhosts" },
      ],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
    });
    // A tool the manifest advertises but nothing serves is a promise an agent
    // cannot cash.
    expect(failures[0]).toContain("registry entry without a route: listGhosts");
  });

  it("honours an infra exclusion on segment boundaries only", () => {
    route("api/mcp", "export const POST = h;");
    route("api/mcp-admin", "export const POST = h;");
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [],
      exclusionsPath: json("exclusions.json", {
        actions: {},
        routes: { "/api/mcp": "the MCP transport itself" },
      }),
    });
    // `/api/mcp` covers itself and its children, never a sibling whose name merely
    // starts the same way.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/api/mcp-admin");
  });

  it("maps dynamic segments the way the registry writes them", () => {
    route("api/orders/[id]", "export const GET = h;");
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [{ method: "GET", path: "/api/orders/{id}", operationId: "getOrder" }],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
    });
    expect(failures).toEqual([]);
  });
});

describe("action coverage", () => {
  it("requires every server action to be mapped or excluded", () => {
    actions("admin", '"use server";\nexport async function archiveOrder() {}');
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
      actionMapPath: json("action-map.json", { mapped: {} }),
    });
    expect(failures[0]).toContain("unmapped server action: archiveOrder");
  });

  it("fails a map entry pointing at an operationId the registry does not have", () => {
    actions("admin", '"use server";\nexport async function archiveOrder() {}');
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
      actionMapPath: json("action-map.json", { mapped: { archiveOrder: "nope" } }),
    });
    expect(failures[0]).toContain("action-map points at unknown operationId");
  });

  it("fails an action that is both mapped and excluded", () => {
    actions("admin", '"use server";\nexport async function archiveOrder() {}');
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [{ method: "POST", path: "/api/x", operationId: "archiveOrder" }],
      exclusionsPath: json("exclusions.json", {
        actions: { archiveOrder: "internal" },
        routes: {},
      }),
      actionMapPath: json("action-map.json", { mapped: { archiveOrder: "archiveOrder" } }),
    });
    expect(failures.some((failure) => failure.includes("both mapped and excluded"))).toBe(true);
  });

  it("fails a STALE exclusion and a stale map entry, so neither file can rot", () => {
    mkdirSync(appDir, { recursive: true });
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [],
      exclusionsPath: json("exclusions.json", { actions: { gone: "was internal" }, routes: {} }),
      actionMapPath: json("action-map.json", { mapped: { alsoGone: "op" } }),
    });
    expect(failures.some((failure) => failure.includes("stale action exclusion: gone"))).toBe(true);
    expect(failures.some((failure) => failure.includes("stale action-map entry: alsoGone"))).toBe(
      true,
    );
  });

  it("leaves a stale ROUTE exclusion alone, exactly as the host gate did", () => {
    route("api/orders", "export const GET = h;");
    const { failures } = runMcpCoverage({
      appDir,
      endpoints: [{ method: "GET", path: "/api/orders", operationId: "listOrders" }],
      exclusionsPath: json("exclusions.json", {
        actions: {},
        routes: { "/api/removed": "deleted last month" },
      }),
    });
    // Deliberately NOT a failure: `mcp:coverage` reports staleness for ACTION
    // exclusions only, and this port preserves that rather than tightening a gate
    // mid-move — a new failure here would go red on a host's committed exclusions
    // file the moment it adopted the package. (`rbac:coverage` does check its own
    // route prefixes; adding it here is a follow-up, with a burn-down.)
    expect(failures).toEqual([]);
  });

  it("treats a host with no server actions as vacuous rather than crashing", () => {
    route("api/orders", "export const GET = h;");
    const { failures, actionCount } = runMcpCoverage({
      appDir,
      endpoints: [{ method: "GET", path: "/api/orders", operationId: "listOrders" }],
      exclusionsPath: json("exclusions.json", NO_EXCLUSIONS),
    });
    expect(failures).toEqual([]);
    expect(actionCount).toBe(0);
  });
});
