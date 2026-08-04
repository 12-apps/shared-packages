import { describe, expect, it } from "vitest";

import { buildManifest, serializeManifest } from "./manifest";
import type { GeneratedTool } from "../types";

function tool(name: string): GeneratedTool {
  return {
    name,
    description: `desc ${name}`,
    method: "GET",
    path: `/${name}`,
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
  };
}

describe("buildManifest", () => {
  it("sorts tools by name regardless of input order", () => {
    const manifest = buildManifest(
      [tool("charlie"), tool("alpha"), tool("bravo")],
      {
        version: 1,
        source: "test",
      },
    );
    expect(manifest.tools.map((t) => t.name)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
    expect(manifest.version).toBe(1);
    expect(manifest.source).toBe("test");
  });
});

describe("serializeManifest", () => {
  it("is deterministic and ends with a trailing newline", () => {
    const a = serializeManifest(
      buildManifest([tool("b"), tool("a")], { version: 1, source: "s" }),
    );
    const b = serializeManifest(
      buildManifest([tool("a"), tool("b")], { version: 1, source: "s" }),
    );
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });

  it("deep-sorts object keys so key order never churns the diff", () => {
    const t1 = tool("x");
    const t2: GeneratedTool = { ...tool("x") };
    // Same data, different key insertion order in inputSchema.
    t1.inputSchema = { type: "object", properties: { b: {}, a: {} } };
    t2.inputSchema = { properties: { a: {}, b: {} }, type: "object" };
    const s1 = serializeManifest(
      buildManifest([t1], { version: 1, source: "s" }),
    );
    const s2 = serializeManifest(
      buildManifest([t2], { version: 1, source: "s" }),
    );
    expect(s1).toBe(s2);
  });
});
