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
/** A title only counts when it has something in it. */
function titleOf(candidate: string | undefined): string | undefined {
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

/**
 * Merge a package's declared defaults under a host's overrides.
 *
 * The four fields are resolved into one record and checked generically rather
 * than branch by branch — which keeps the "host wins, and `false` is an
 * answer" rule stated exactly once per field instead of once per field per
 * check.
 *
 * `??` and not `||` throughout, and that is the trap the whole merge turns on:
 * `false` is a real classification — "this tool does not destroy" — and must
 * not fall through to the package's answer.
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
  const host = overrides ?? {};
  const declared = defaults ?? {};
  const resolved: Partial<ToolAnnotations> = {
    title: titleOf(host.title ?? declared.title),
    readOnlyHint: host.readOnlyHint ?? declared.readOnly,
    openWorldHint: host.openWorldHint ?? declared.openWorld,
    destructiveHint: host.destructiveHint ?? declared.destructive,
  };

  const missing = REQUIRED_FIELDS.filter((field) => resolved[field] === undefined);
  if (missing.length > 0) refuse(name, missing);
  return resolved as ToolAnnotations;
}

/** Every field a served tool must end with — the completeness property itself. */
const REQUIRED_FIELDS = [
  "title",
  "readOnlyHint",
  "openWorldHint",
  "destructiveHint",
] as const satisfies readonly (keyof ToolAnnotations)[];

function refuse(name: string, missing: readonly string[]): never {
  throw new Error(
    `MCP tool "${name}" ends unclassified: neither the package nor the host supplied ` +
      `${missing.join(", ")}. Every served tool needs a complete classification — a missing ` +
      `hint blocks ChatGPT App review, and the connector directory derives auto-permissions ` +
      `from readOnlyHint/destructiveHint.`,
  );
}
