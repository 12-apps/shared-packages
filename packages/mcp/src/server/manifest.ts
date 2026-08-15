import type { GeneratedTool, ToolManifest } from "../types";

/**
 * The manifest is the committed source-of-truth artifact the CI drift gate
 * (`mcp:check` → `12-apps/ci` `mcp-contract.yml`) diffs against a fresh
 * regeneration. If an endpoint's schema changes without the manifest being
 * regenerated, the diff fails the build — that is how the served MCP surface is
 * kept in lockstep with the endpoint surface.
 */

export interface BuildManifestOptions {
  /** Bumped intentionally on any tool-shape change (mirrors the golden catalog). */
  version: number;
  /** Human label for the spec, e.g. "acme web @ openapi.json". */
  source: string;
}

/** Sort object keys recursively so serialization is stable regardless of insertion order. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, val]) => [key, sortDeep(val)]));
  }
  return value;
}

export function buildManifest(
  tools: GeneratedTool[],
  options: BuildManifestOptions,
): ToolManifest {
  // Tools are sorted by name so the manifest ordering is deterministic across
  // spec edits that reorder paths.
  const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { version: options.version, source: options.source, tools: sorted };
}

/**
 * Canonical JSON for a manifest — deep-key-sorted and trailing-newline'd, so the
 * committed artifact and a regeneration diff cleanly (no key-order or whitespace
 * churn). `mcp:check` regenerates, serializes with this, and `git diff --exit-code`s.
 */
export function serializeManifest(manifest: ToolManifest): string {
  return `${JSON.stringify(sortDeep(manifest), null, 2)}\n`;
}
