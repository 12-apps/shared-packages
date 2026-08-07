import { describe, expect, it } from "vitest";

import {
  serializeSurfaceLock,
  surfaceDigest,
  surfaceLockProblem,
  type SurfaceLock,
} from "./surface-lock";
import type { GeneratedTool } from "../types";

const SOURCE = "test";
const WHERE = "apps/web/lib/mcp/surface-version.ts";

function tool(overrides: Partial<GeneratedTool> = {}): GeneratedTool {
  return {
    name: "listProducts",
    description: "List a store's products.",
    method: "GET",
    path: "/products",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
    parameters: [],
    bodyProps: [],
    bodyIsWhole: false,
    mutating: false,
    security: [],
    ...overrides,
  };
}

describe("surfaceDigest", () => {
  it("is stable for the same surface", () => {
    expect(surfaceDigest([tool()], SOURCE)).toBe(surfaceDigest([tool()], SOURCE));
  });

  it("ignores tool ORDER — the manifest sorts by name anyway", () => {
    const a = tool({ name: "aTool" });
    const b = tool({ name: "bTool" });

    expect(surfaceDigest([a, b], SOURCE)).toBe(surfaceDigest([b, a], SOURCE));
  });

  it("ignores key insertion order inside a schema", () => {
    const one = tool({ inputSchema: { type: "object", properties: { b: {}, a: {} } } });
    const two = tool({ inputSchema: { properties: { a: {}, b: {} }, type: "object" } });

    expect(surfaceDigest([one], SOURCE)).toBe(surfaceDigest([two], SOURCE));
  });

  it.each([
    ["a tool is added", [tool(), tool({ name: "uploadImage" })]],
    ["a tool is renamed", [tool({ name: "listItems" })]],
    ["a description is edited", [tool({ description: "List everything." })]],
    [
      "an input schema moves",
      [tool({ inputSchema: { type: "object", properties: { q: { type: "string" } } } })],
    ],
    [
      "an annotation flips",
      [
        tool({
          annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
          },
        }),
      ],
    ],
  ])("moves when %s — each is something a client would see differently", (_label, tools) => {
    expect(surfaceDigest(tools, SOURCE)).not.toBe(surfaceDigest([tool()], SOURCE));
  });

  it("does not depend on the version, or bumping would satisfy the gate by itself", () => {
    // The digest is computed with the version pinned out. If it moved with the
    // version, "did the surface change?" would answer yes to a pure release
    // bump, and the whole check would prove nothing.
    const digest = surfaceDigest([tool()], SOURCE);

    expect(
      surfaceLockProblem({
        previous: { version: 7, digest },
        version: 7,
        digest,
        versionLocation: WHERE,
      }),
    ).toBeNull();
  });
});

describe("surfaceLockProblem", () => {
  const DIGEST = "aaaaaaaaaaaaaaaa";
  const MOVED = "bbbbbbbbbbbbbbbb";
  const previous: SurfaceLock = { version: 2, digest: DIGEST };

  it("fails when the surface changed under an unchanged version", () => {
    // The case the whole mechanism exists for: a tool that reaches production
    // behind a version no connected client has a reason to re-read.
    const problem = surfaceLockProblem({
      previous,
      version: 2,
      digest: MOVED,
      versionLocation: WHERE,
    });

    expect(problem).toContain("the served tool surface changed");
    expect(problem).toContain(`MCP_SURFACE_VERSION = 3 in ${WHERE}`);
    expect(problem).toContain(`${DIGEST} → ${MOVED}`);
  });

  it("names the app's own constant when it does not use the default", () => {
    const problem = surfaceLockProblem({
      previous,
      version: 2,
      digest: MOVED,
      versionLocation: "src/version.ts",
      versionName: "TOOL_SURFACE",
    });

    expect(problem).toContain("TOOL_SURFACE is still 2");
    expect(problem).toContain("Set TOOL_SURFACE = 3 in src/version.ts");
  });

  it("passes when the surface changed and the version moved with it", () => {
    expect(
      surfaceLockProblem({ previous, version: 3, digest: MOVED, versionLocation: WHERE }),
    ).toBeNull();
  });

  it("passes on a version bump with no surface change — a release is allowed", () => {
    expect(
      surfaceLockProblem({ previous, version: 3, digest: DIGEST, versionLocation: WHERE }),
    ).toBeNull();
  });

  it("passes when nothing moved at all", () => {
    expect(
      surfaceLockProblem({ previous, version: 2, digest: DIGEST, versionLocation: WHERE }),
    ).toBeNull();
  });

  it("passes with no lock to contradict — first run, or the file was deleted", () => {
    expect(
      surfaceLockProblem({ previous: null, version: 1, digest: DIGEST, versionLocation: WHERE }),
    ).toBeNull();
  });

  it("names the NEXT version, so the fix is copy-paste rather than arithmetic", () => {
    expect(
      surfaceLockProblem({
        previous: { version: 41, digest: DIGEST },
        version: 41,
        digest: MOVED,
        versionLocation: WHERE,
      }),
    ).toContain("MCP_SURFACE_VERSION = 42");
  });
});

describe("serializeSurfaceLock", () => {
  it("writes canonical JSON with a trailing newline, like the manifest", () => {
    // A consumer's `--check` byte-compares the committed file, so the
    // serialization has to be the one the writer produces — newline included.
    expect(serializeSurfaceLock({ version: 2, digest: "abc" })).toBe(
      '{\n  "version": 2,\n  "digest": "abc"\n}\n',
    );
  });
});
