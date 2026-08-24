/**
 * Composing a tool's behavior classification out of two sources.
 *
 * The rule the host's gate enforces is unchanged: every served tool ends with
 * a COMPLETE `ToolAnnotations` — a title and all three hints — and a tool that
 * ends unclassified fails `mcp:lint`. ChatGPT App review treats a missing hint
 * as a blocker, and the Anthropic connector directory derives auto-permissions
 * from `readOnlyHint`/`destructiveHint`, so there is no defensible default for
 * "we did not say".
 *
 * What this adds is where the answer may COME FROM. A package that declares
 * `getSupplierVersions` knows it reads and does not destroy; the host cannot
 * know that without reading the package's source, so it restated the
 * classification by hand — one line per tool, per collection, wrong the moment
 * the package changed a verb. Now the package can assert what it knows and the
 * host's table becomes what it should always have been: OVERRIDES, plus the
 * tools the host itself owns.
 *
 * ## Precedence, and why it runs this way
 *
 * The HOST wins every field it states. A package's claim is a default, not a
 * fact about the host's deployment: the same endpoint can be read-only in one
 * app and reach an external service in another (a host that proxies its
 * catalog reads through a vendor), and the host is the only party that knows.
 * Inverting this would make a package version bump silently re-classify a tool
 * an operator had already audited — the exact thing an audited classification
 * exists to prevent.
 *
 * ## What it refuses
 *
 * A field neither side supplies. `resolveToolAnnotations` throws naming the
 * tool and the missing fields, which keeps the completeness property a
 * REFUSAL rather than a lint pass over a table that quietly grew a gap. The
 * host's own gate can keep its message; this one fires first and says the same
 * thing in the same terms.
 */

import type { ToolAnnotations } from "../types";
import type { McpAnnotationDefaults } from "./endpoint";

/** The host's half — whatever it chose to state, per tool. */
export type ToolAnnotationOverrides = Partial<ToolAnnotations>;

/**
 * Merge a package's declared defaults under a host's overrides.
 *
 * @param name the tool id, for the refusal message
 * @param defaults what the package asserted (`McpEndpoint.annotations`)
 * @param overrides what the host's own table says; wins every field it states
 */
export function resolveToolAnnotations(
  name: string,
  defaults: McpAnnotationDefaults | undefined,
  overrides: ToolAnnotationOverrides | undefined,
): ToolAnnotations {
  const title = overrides?.title ?? defaults?.title;
  const readOnlyHint = overrides?.readOnlyHint ?? defaults?.readOnly;
  const openWorldHint = overrides?.openWorldHint ?? defaults?.openWorld;
  const destructiveHint = overrides?.destructiveHint ?? defaults?.destructive;

  const missing = [
    typeof title === "string" && title.trim() !== "" ? null : "title",
    typeof readOnlyHint === "boolean" ? null : "readOnlyHint",
    typeof openWorldHint === "boolean" ? null : "openWorldHint",
    typeof destructiveHint === "boolean" ? null : "destructiveHint",
  ].filter((field): field is string => field !== null);

  if (missing.length > 0) {
    throw new Error(
      `MCP tool "${name}" ends unclassified: neither the package nor the host supplied ` +
        `${missing.join(", ")}. Every served tool needs a complete classification — a missing ` +
        `hint blocks ChatGPT App review, and the connector directory derives auto-permissions ` +
        `from readOnlyHint/destructiveHint.`,
    );
  }

  // Narrowed by the check above; the casts are what the filter proved.
  return {
    title: title as string,
    readOnlyHint: readOnlyHint as boolean,
    openWorldHint: openWorldHint as boolean,
    destructiveHint: destructiveHint as boolean,
  };
}
