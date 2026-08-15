import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { generateTools, type OpenApiDocument } from "../openapi/generate";
import { buildManifest, serializeManifest } from "../server/manifest";
import {
  serializeSurfaceLock,
  surfaceDigest,
  surfaceLockProblem,
  type SurfaceLock,
} from "../server/surface-lock";
import type { ToolManifest } from "../types";

/**
 * `@12-apps/mcp/generate` — the `mcp:generate` / `mcp:check` gate (12-23), moved
 * out of the origin host's `apps/web/scripts/mcp/generate.ts` so a host's own script is
 * a one-line call and `12-apps/ci`'s `mcp-contract.yml`, which shells out to the
 * consumer's `mcp:check` package script, keeps working unchanged.
 *
 * It renders the committed surface artifacts from the host's OpenAPI document:
 *
 *   openapi.json      — the document itself, canonicalized
 *   manifest.json     — the MCP tool manifest generated from it
 *   surface-lock.json — which surface the current version stands for
 *
 * With `check: true` it regenerates IN MEMORY and fails on any drift — the same
 * command CI runs, so a forgotten regeneration is a red build rather than a tool
 * list that silently disagrees with the endpoints.
 *
 * It ALSO refuses, in both modes, to emit a tool surface that changed while the
 * advertised VERSION did not. That version is the only signal a connected host has
 * that `tools/list` is worth re-reading, so a shipped tool behind an unmoved
 * version is invisible to every client that already cached it — and "remember to
 * bump it" as a comment is not a rule (see `server/surface-lock.ts`).
 */

/** One extra artifact a host renders from the same manifest, e.g. a store submission. */
export interface McpExtraArtifact {
  /** Absolute path of the committed file. */
  path: string;
  /** Rendered text, INCLUDING its trailing newline (compared byte for byte). */
  render: (manifest: ToolManifest) => string;
}

export interface McpGenerateOptions {
  /**
   * The host's OpenAPI document, or a thunk producing it. A thunk is the useful
   * form: building it usually evaluates a Zod registry, and `--check` should pay
   * that cost once, when it runs.
   */
  document: OpenApiDocument | (() => OpenApiDocument);
  /**
   * The advertised surface version — the number a client is handed on `initialize`
   * and caches `tools/list` against.
   */
  version: number;
  /** Human label for the spec the tools were generated from. */
  source: string;
  /**
   * Where the host's version constant lives, repo-relative — quoted verbatim in
   * the surface-lock failure, so the fix is a path and a value rather than a hunt.
   */
  versionLocation: string;
  /** The constant's name, if the host does not call it `MCP_SURFACE_VERSION`. */
  versionName?: string;
  /** Where the three artifacts are committed. */
  outputs: {
    openapi: string;
    manifest: string;
    surfaceLock: string;
  };
  /** Anything else the host commits from the same manifest. */
  extraArtifacts?: readonly McpExtraArtifact[];
}

/** The rendered text of every artifact, keyed by its committed path. */
export type RenderedArtifacts = Map<string, string>;

export interface McpGenerateResult {
  artifacts: RenderedArtifacts;
  /** Non-null when the surface moved without a version bump — the message to print. */
  surfaceProblem: string | null;
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readSurfaceLock(path: string): SurfaceLock | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SurfaceLock;
  } catch {
    // No lock committed yet — there is nothing to contradict.
    return null;
  }
}

/**
 * Render every artifact from the document. Pure: nothing is written and nothing is
 * compared, so a caller can diff, print or discard the result.
 */
export function renderMcpArtifacts(options: McpGenerateOptions): McpGenerateResult {
  const document =
    typeof options.document === "function" ? options.document() : options.document;
  const tools = generateTools(document);

  // Before anything is written or compared: does this version still stand for this
  // surface? The digest is of what `tools/list` would actually return, which is
  // neither over- nor under-sensitive the way a paths filter on the registry's
  // source tree is in both directions.
  const digest = surfaceDigest(tools, options.source);
  const surfaceProblem = surfaceLockProblem({
    previous: readSurfaceLock(options.outputs.surfaceLock),
    version: options.version,
    digest,
    versionLocation: options.versionLocation,
    ...(options.versionName ? { versionName: options.versionName } : {}),
  });

  const manifestValue = buildManifest(tools, {
    version: options.version,
    source: options.source,
  });

  const artifacts: RenderedArtifacts = new Map([
    [options.outputs.openapi, `${JSON.stringify(document, null, 2)}\n`],
    [options.outputs.manifest, serializeManifest(manifestValue)],
    [
      options.outputs.surfaceLock,
      serializeSurfaceLock({ version: options.version, digest }),
    ],
  ]);
  for (const extra of options.extraArtifacts ?? []) {
    artifacts.set(extra.path, extra.render(manifestValue));
  }

  return { artifacts, surfaceProblem };
}

/** Every artifact whose committed text differs from a fresh render. */
export function mcpArtifactDrift(artifacts: RenderedArtifacts): string[] {
  return [...artifacts.entries()]
    .filter(([path, rendered]) => readOrEmpty(path) !== rendered)
    .map(([path]) => path);
}

/** Write every artifact, creating directories as needed. */
export function writeMcpArtifacts(artifacts: RenderedArtifacts): void {
  for (const [path, contents] of artifacts) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

export interface McpGenerateCliOptions extends McpGenerateOptions {
  /** `true` for `mcp:check` (verify only), `false` for `mcp:generate` (write). */
  check: boolean;
  /** The command to suggest on drift. Default: `pnpm mcp:generate`. */
  regenerateCommand?: string;
}

/**
 * The CLI face: render, then either verify or write, printing the verdict and
 * exiting non-zero on any failure. A host's `scripts/mcp/generate.ts` becomes an
 * import, its document builder, and one call.
 */
export function mcpGenerateCli(options: McpGenerateCliOptions): void {
  const { artifacts, surfaceProblem } = renderMcpArtifacts(options);

  if (surfaceProblem) {
    // Exits rather than throws so the message IS the whole output — it names the
    // number to change and where, which is the entire point of failing here
    // instead of leaving it to review.
    console.error(`[mcp:surface] ${surfaceProblem}`);
    process.exit(1);
  }

  if (options.check) {
    const drift = mcpArtifactDrift(artifacts);
    if (drift.length > 0) {
      console.error(
        `[mcp:check] drift in: ${drift.join(", ")}.\n` +
          `Run \`${options.regenerateCommand ?? "pnpm mcp:generate"}\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log("[mcp:check] MCP surface is in sync with the OpenAPI registry.");
    return;
  }

  writeMcpArtifacts(artifacts);
  console.log(`[mcp:generate] wrote ${[...artifacts.keys()].join(", ")}`);
}
