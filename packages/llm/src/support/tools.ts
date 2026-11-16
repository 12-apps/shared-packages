/**
 * A support tier's tools: least privilege, scope-bound.
 *
 * - Each tier lists EXACTLY its own tools. Nothing is shared between tiers;
 *   the ladder adds only its own `escalate` tool.
 * - A tool runs with the `scope` the HOST gave `handle()` (which tenant, which
 *   account), never one the model chose. The host names the scope-bound
 *   fields; a tool whose schema exposes one is refused when the ladder is
 *   built (or when a source resolves it), and a call whose arguments carry one
 *   is refused without running.
 * - A turn that calls `escalate` leaves the tier: its other tool calls are
 *   answered "not run" and never reach a host tool.
 */
import { SupportLadderError } from "../errors";
import type { ToolExecutor, ToolOutput } from "../loop";
import type { ToolCall, ToolDefinition } from "../types";

/** What a tool's `run` is told, all of it from the host, none from the model. */
export interface SupportToolContext<Scope = unknown, Context = unknown> {
  scope: Scope;
  context: Context;
  conversationId: string;
  /** The id of the tier whose model called the tool. */
  tier: string;
  call: ToolCall;
}

/** A tool a tier offers its model: a strict definition and its handler. */
export interface SupportTool<Scope = unknown, Context = unknown> {
  definition: ToolDefinition;
  run(input: unknown, context: SupportToolContext<Scope, Context>): ToolOutput | Promise<ToolOutput>;
}

/**
 * Tools resolved per `handle()` call for that call's scope, such as an MCP
 * server reached with the scope's own credentials (`mcpTools`).
 */
export interface SupportToolSource<Scope = unknown, Context = unknown> {
  resolve(scope: Scope): readonly SupportTool<Scope, Context>[] | Promise<readonly SupportTool<Scope, Context>[]>;
}

export type SupportToolEntry<Scope = unknown, Context = unknown> = SupportTool<Scope, Context> | SupportToolSource<Scope, Context>;

/** The ladder's own tool. */
export const ESCALATE_TOOL = "escalate";

export type EscalationTarget = "next" | "person";

export interface EscalationRequest {
  to: EscalationTarget;
  reason: string;
}

export function isToolSource<S, C>(entry: SupportToolEntry<S, C>): entry is SupportToolSource<S, C> {
  return typeof (entry as SupportToolSource<S, C>).resolve === "function";
}

/** The escalate tool; `"next"` is offered only when a next tier exists. */
export function escalateDefinition(canGoNext: boolean): ToolDefinition {
  const targets: EscalationTarget[] = canGoNext ? ["next", "person"] : ["person"];
  const where = canGoNext
    ? 'to a more capable assistant ("next") or to a person ("person")'
    : 'to a person ("person")';
  return {
    name: ESCALATE_TOOL,
    description: `Hand this conversation ${where} when you cannot resolve it yourself. Say why in "reason".`,
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", enum: targets },
        reason: { type: "string" },
      },
      required: ["to", "reason"],
      additionalProperties: false,
    },
  };
}

/** The escalation the model asked for, or the error text it gets back. */
export function parseEscalation(input: unknown, canGoNext: boolean): EscalationRequest | string {
  const { to, reason } = (input && typeof input === "object" ? input : {}) as { to?: unknown; reason?: unknown };
  const allowed = canGoNext ? ["next", "person"] : ["person"];
  if (typeof to !== "string" || !allowed.includes(to)) return `"to" must be one of: ${allowed.join(", ")}.`;
  if (typeof reason !== "string" || reason.trim() === "") return '"reason" must say why.';
  return { to: to as EscalationTarget, reason: reason.trim() };
}

/** Every property name declared anywhere in a schema (nested ones included). */
function declaredFields(schema: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const properties = (node as { properties?: unknown }).properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      Object.keys(properties).forEach((key) => found.add(key));
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return found;
}

/** Every key of every object anywhere in a value. */
function presentKeys(value: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node)) Object.keys(node).forEach((key) => found.add(key));
    Object.values(node).forEach(visit);
  };
  visit(value);
  return found;
}

/** The first scope-bound field among a model call's arguments, if any. */
function scopeFieldIn(input: unknown, scopeFields: readonly string[]): string | undefined {
  if (scopeFields.length === 0) return undefined;
  const keys = presentKeys(input);
  return scopeFields.find((field) => keys.has(field));
}

/** Refuse a tool set with a clash, an `escalate` of its own, or a schema exposing the scope. */
export function checkTools(tierId: string, tools: readonly SupportTool<unknown, unknown>[], scopeFields: readonly string[]): void {
  const seen = new Set<string>([ESCALATE_TOOL]);
  tools.forEach(({ definition }) => {
    if (seen.has(definition.name)) {
      throw new SupportLadderError("tool_conflict", `tier "${tierId}" offers the tool "${definition.name}" twice, or names it like the ladder's own.`);
    }
    seen.add(definition.name);
    const fields = declaredFields(definition.inputSchema);
    const exposed = scopeFields.find((field) => fields.has(field));
    if (exposed) {
      throw new SupportLadderError(
        "scope_exposed",
        `tier "${tierId}": the tool "${definition.name}" lets the model set "${exposed}", which the host binds to the scope.`,
      );
    }
  });
}

/** A tier's tools for one call: the static ones plus every source resolved for `scope`. */
export async function resolveTools<S, C>(
  tierId: string,
  entries: readonly SupportToolEntry<S, C>[],
  scope: S,
  scopeFields: readonly string[],
): Promise<SupportTool<S, C>[]> {
  const lists = await Promise.all(entries.map(async (entry) => (isToolSource(entry) ? [...(await entry.resolve(scope))] : [entry])));
  const tools = lists.flat();
  checkTools(tierId, tools as readonly SupportTool<unknown, unknown>[], scopeFields);
  return tools;
}

/** A host tool's output, with any `halt` dropped: only the ladder leaves a tier. */
function withoutHalt(out: ToolOutput): ToolOutput {
  return typeof out === "string" ? out : { output: out.output, ...(out.isError ? { isError: true } : {}) };
}

/** True when a turn calls `escalate`: the turn leaves the tier, so its host tools are not run. */
function escalatesIn(calls: readonly ToolCall[]): boolean {
  return calls.some((call) => call.name === ESCALATE_TOOL);
}

/** The loop's executors for a tier's tools, each bound to the host's scope. */
export function bindExecutors<S, C>(
  tools: readonly SupportTool<S, C>[],
  bound: Omit<SupportToolContext<S, C>, "call">,
  scopeFields: readonly string[],
): Record<string, ToolExecutor> {
  const executors: Record<string, ToolExecutor> = {};
  tools.forEach((tool) => {
    executors[tool.definition.name] = async (input, { call, calls }) => {
      if (escalatesIn(calls)) return { output: "Not run: this turn escalated the conversation.", isError: true };
      const leaked = scopeFieldIn(input, scopeFields);
      if (leaked) return { output: `Refused: "${leaked}" is set by the host, never by the assistant.`, isError: true };
      return withoutHalt(await tool.run(input, { ...bound, call }));
    };
  });
  return executors;
}
