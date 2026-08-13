/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the subject:
   `mcp:check` compares COMMITTED bytes against a fresh render, so a mocked `fs`
   would assert the mock. Every path written here is inside a per-case temp
   directory removed in the same case. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { OpenApiDocument } from "../../openapi/generate";
import {
  mcpArtifactDrift,
  renderMcpArtifacts,
  writeMcpArtifacts,
  type McpGenerateOptions,
} from "../index";

/**
 * The `mcp:generate` / `mcp:check` gate as a LIBRARY (12-23).
 *
 * It was a script in future-pay, which is why a second app could not have it: a
 * script gets copied, and a copy drifts. What matters about the move is that the
 * two properties the gate exists for survive it —
 *
 *  1. **drift is measured against the COMMITTED bytes**, so a forgotten
 *     regeneration is a red build rather than a tool list that silently disagrees
 *     with the endpoints;
 *  2. **the surface cannot move while the advertised version stands still.** That
 *     version is the only signal a connected host has that `tools/list` is worth
 *     re-reading, so a tool shipped behind an unmoved version stays invisible to
 *     every client that already cached the list.
 */

/**
 * A one-operation document — enough to have a surface that can change.
 *
 * The annotations are not decoration: the generator REFUSES an operation that does
 * not state its three hints and a human title, so a document without them cannot
 * be generated from at all. Stating them here is what a host's registry does.
 */
function documentWith(operationId: string): OpenApiDocument {
  return {
    paths: {
      "/orders": {
        get: {
          operationId,
          summary: "List orders",
          responses: { "200": { description: "ok" } },
          "x-mcp-tool-annotations": {
            title: "List orders",
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
          },
        },
      },
    },
  };
}

interface Fixture {
  dir: string;
  options: (overrides?: Partial<McpGenerateOptions>) => McpGenerateOptions;
  cleanup: () => void;
}

/** A temp directory standing in for the host's committed artifact paths. */
function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "mcp-generate-"));
  return {
    dir,
    options: (overrides = {}) => ({
      document: documentWith("listOrders"),
      version: 1,
      source: "openapi.json",
      versionLocation: "lib/mcp/surface-version.ts",
      outputs: {
        openapi: join(dir, "openapi.json"),
        manifest: join(dir, "manifest.json"),
        surfaceLock: join(dir, "surface-lock.json"),
      },
      ...overrides,
    }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("renderMcpArtifacts", () => {
  it("renders the three committed artifacts and writes nothing", () => {
    const fx = fixture();
    try {
      const { artifacts, surfaceProblem } = renderMcpArtifacts(fx.options());
      expect(surfaceProblem).toBeNull();
      expect([...artifacts.keys()]).toEqual([
        join(fx.dir, "openapi.json"),
        join(fx.dir, "manifest.json"),
        join(fx.dir, "surface-lock.json"),
      ]);
      // Every artifact ends in a newline: they are committed files, and a missing
      // one is a diff on every regeneration.
      for (const text of artifacts.values()) expect(text.endsWith("\n")).toBe(true);
      // Pure. Rendering is what a `--check` run does, and it must not write —
      // nothing on disk yet means all three read as drift.
      expect(mcpArtifactDrift(artifacts)).toHaveLength(3);
    } finally {
      fx.cleanup();
    }
  });

  it("builds the document ONCE, though several artifacts derive from it", () => {
    const fx = fixture();
    try {
      // A container's property, not a closed-over binding: reassigning one from
      // inside a stub is exactly what the flakiness gate rejects.
      const builds = { count: 0 };
      renderMcpArtifacts(
        fx.options({
          document: (): OpenApiDocument => {
            builds.count += 1;
            return documentWith("listOrders");
          },
        }),
      );
      // The thunk exists so a `--check` run pays the Zod-registry cost once.
      expect(builds.count).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it("renders a host's extra artifact from the same manifest", () => {
    const fx = fixture();
    try {
      const extraPath = join(fx.dir, "store-submission.json");
      const { artifacts } = renderMcpArtifacts(
        fx.options({
          extraArtifacts: [
            {
              path: extraPath,
              render: (manifest) => `${JSON.stringify({ tools: manifest.tools.length })}\n`,
            },
          ],
        }),
      );
      // One tool in, one tool out — and rendered from the manifest the other
      // artifacts were built from, not from a second generation.
      expect(artifacts.get(extraPath)).toBe('{"tools":1}\n');
    } finally {
      fx.cleanup();
    }
  });
});

describe("drift, against the committed bytes", () => {
  it("reports nothing once the artifacts are written", () => {
    const fx = fixture();
    try {
      const { artifacts } = renderMcpArtifacts(fx.options());
      writeMcpArtifacts(artifacts);
      expect(mcpArtifactDrift(artifacts)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it("names the artifact whose committed text no longer matches", () => {
    const fx = fixture();
    try {
      writeMcpArtifacts(renderMcpArtifacts(fx.options()).artifacts);
      // The regeneration somebody forgot: the surface changed, the files did not.
      const { artifacts } = renderMcpArtifacts(
        fx.options({ document: documentWith("listOrdersV2"), version: 2 }),
      );
      expect(mcpArtifactDrift(artifacts)).toContain(join(fx.dir, "manifest.json"));
    } finally {
      fx.cleanup();
    }
  });

  it("treats a MISSING artifact as drift, not as nothing to compare", () => {
    const fx = fixture();
    try {
      const { artifacts } = renderMcpArtifacts(fx.options());
      writeMcpArtifacts(artifacts);
      rmSync(join(fx.dir, "manifest.json"));
      expect(mcpArtifactDrift(artifacts)).toEqual([join(fx.dir, "manifest.json")]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("the surface lock", () => {
  it("passes when the surface is unchanged", () => {
    const fx = fixture();
    try {
      writeMcpArtifacts(renderMcpArtifacts(fx.options()).artifacts);
      expect(renderMcpArtifacts(fx.options()).surfaceProblem).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  it("refuses a moved surface behind a version that did not move", () => {
    const fx = fixture();
    try {
      writeMcpArtifacts(renderMcpArtifacts(fx.options()).artifacts);
      // A changed tool surface at the same advertised version — invisible to every
      // already-connected client, and the exact failure that reached production.
      const { surfaceProblem } = renderMcpArtifacts(
        fx.options({ document: documentWith("listOrdersRenamed") }),
      );
      expect(surfaceProblem).not.toBeNull();
      // The message names WHERE the number lives, so the fix is not a hunt.
      expect(surfaceProblem).toContain("lib/mcp/surface-version.ts");
    } finally {
      fx.cleanup();
    }
  });

  it("accepts the same moved surface once the version is bumped", () => {
    const fx = fixture();
    try {
      writeMcpArtifacts(renderMcpArtifacts(fx.options()).artifacts);
      const { surfaceProblem } = renderMcpArtifacts(
        fx.options({ document: documentWith("listOrdersRenamed"), version: 2 }),
      );
      expect(surfaceProblem).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  it("has nothing to contradict when no lock is committed yet", () => {
    const fx = fixture();
    try {
      expect(renderMcpArtifacts(fx.options()).surfaceProblem).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  it("survives a lock file that is not readable JSON", () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.dir, "surface-lock.json"), "{ not json");
      // A corrupt lock must not crash the generator: there is simply no previous
      // surface to compare against.
      expect(renderMcpArtifacts(fx.options()).surfaceProblem).toBeNull();
    } finally {
      fx.cleanup();
    }
  });
});

describe("writeMcpArtifacts", () => {
  it("creates the directories a host's paths imply", () => {
    const fx = fixture();
    try {
      const nested = join(fx.dir, "deep", "nested", "manifest.json");
      writeMcpArtifacts(new Map([[nested, "{}\n"]]));
      expect(readFileSync(nested, "utf8")).toBe("{}\n");
    } finally {
      fx.cleanup();
    }
  });
});
