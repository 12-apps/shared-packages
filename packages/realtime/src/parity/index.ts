import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `@12-apps/realtime/parity` — the publisher-parity gate (12-16), moved out of
 * future-pay's `apps/web/scripts/realtime/publisher-gate.ts` so a host's own script is a
 * one-line re-export and the CI job that shells out to a package script keeps working
 * unchanged. Packaged the same way `@12-apps/rbac/coverage` is: a library plus a CLI
 * wrapper, with the host's lists as DEFAULTS.
 *
 * ## Why a publisher seam needs a gate at all
 *
 * A domain is AUTHORIZABLE the moment it is listed in the registry. Nothing requires it
 * to have an emitter, so a screen can connect successfully, report itself live, slow its
 * poll — and never receive an event. That is worse than not subscribing at all:
 *
 *   1. The endpoint authorizes, opens the stream and heartbeats every 25 s.
 *   2. The client's status is `connected`.
 *   3. The screen's chip says "live".
 *   4. `reconcileRefetchInterval` SLOWS the poll — on a kitchen board, 5 s to 30 s.
 *
 * The screen ends up six times staler than before it adopted realtime, while announcing
 * the opposite. It shipped for real once (FUT-440) and two domains sat silent for months.
 *
 * ## What this checks that a compiler cannot
 *
 * A host declares its publishers as `Record<Domain, PublisherDeclaration>`, so the
 * COMPILER already forces every domain to appear. This checks the declarations are TRUE:
 *
 *   1. A `publishes` module must exist and actually call `publishRealtimeEvent`.
 *      Otherwise the declaration is just a second place to be wrong.
 *   2. The set of `silent` domains may only SHRINK against the baseline file — the same
 *      ratchet as `.quality-exceptions`. Debt can be paid down, never grown. It fails in
 *      BOTH directions: a new silent domain is refused, and a baseline entry that now
 *      publishes must be deleted, so paying the debt is permanent.
 */

/** How one domain accounts for its emitter. */
export type PublisherDeclaration =
  | {
      readonly kind: "publishes";
      /** Repo-relative module that calls `publishRealtimeEvent` for this domain. */
      readonly module: string;
    }
  | {
      readonly kind: "silent";
      /** The ticket that will give this domain a publisher. */
      readonly ticket: string;
      /** What a subscriber is therefore NOT told. */
      readonly why: string;
    };

/** One domain's declaration, tagged with the topic scheme it belongs to. */
export interface PublisherEntry {
  scheme: "tenant" | "user";
  domain: string;
  declaration: PublisherDeclaration;
}

/**
 * The call that proves a module really emits.
 *
 * The optional type-argument list is not decoration: a real publisher narrowing the
 * envelope's generic — `publishRealtimeEvent<ResearchRunWireEvent["data"]>(…)` — is
 * missed by a literal `"publishRealtimeEvent("` match, and that declared a working
 * publisher absent on this gate's very first run.
 */
const EMIT_CALL = /\bpublishRealtimeEvent\s*(?:<[^>]*>)?\s*\(/;

/** Where the ratchet lives, relative to the repo root. */
export const DEFAULT_SILENT_BASELINE = ".realtime-silent-domains.json";

/**
 * future-pay's own declarations — the DEFAULT set, overridable per host.
 *
 * Shipped for the same reason `@12-apps/rbac/coverage` ships `FUTURE_PAY_RBAC_GUARDS`: a
 * host with the future-pay layout adopts the gate with no configuration, and a host with
 * a different one passes its own `declarations`. The module paths are repo-relative and
 * resolved against the caller's `root`.
 */
export const FUTURE_PAY_PUBLISHER_DECLARATIONS: readonly PublisherEntry[] = [
  {
    scheme: "tenant",
    domain: "kitchen",
    // Work moves here; the shift lifecycle half lives in shift-hints.ts, which reuses
    // this module's fan-out rather than addressing topics itself.
    declaration: { kind: "publishes", module: "apps/web/lib/realtime/kitchen-hints.ts" },
  },
  {
    scheme: "tenant",
    domain: "tables",
    // The floor's lifecycle: comanda close/reopen, and the waiter-call moves the tables
    // screen renders beside them.
    declaration: { kind: "publishes", module: "apps/web/lib/realtime/tables-hints.ts" },
  },
  {
    scheme: "tenant",
    domain: "orders",
    // Everything the orders list draws: an order appearing, its payment settling or
    // parking, its fulfillment moving, a cancel, an expiry.
    declaration: { kind: "publishes", module: "apps/web/lib/realtime/order-hints.ts" },
  },
  {
    scheme: "tenant",
    domain: "comanda",
    // The buyer's own channel: the order, the kitchen ticket's progress, the bill's
    // lifecycle.
    declaration: { kind: "publishes", module: "apps/web/lib/realtime/comanda-hints.ts" },
  },
  {
    scheme: "tenant",
    domain: "research-run",
    declaration: { kind: "publishes", module: "apps/web/lib/research/realtime.ts" },
  },
  {
    scheme: "user",
    domain: "consent",
    declaration: { kind: "publishes", module: "apps/web/lib/realtime/user-hints.ts" },
  },
  {
    scheme: "user",
    domain: "notifications",
    declaration: { kind: "publishes", module: "apps/web/lib/realtime/user-hints.ts" },
  },
];

export interface PublisherParityOptions {
  /** Repo root every declared module path is resolved against. */
  root: string;
  /** The host's declarations. Defaults to {@link FUTURE_PAY_PUBLISHER_DECLARATIONS}. */
  declarations?: readonly PublisherEntry[];
  /** The ratchet file, relative to `root`. Defaults to {@link DEFAULT_SILENT_BASELINE}. */
  baselineFile?: string;
}

export interface PublisherParityResult {
  ok: boolean;
  /** Every violation, already phrased for a human. */
  problems: string[];
  /** `scheme:domain` of every domain declared silent, sorted. */
  silent: string[];
  /** How many domains publish. */
  publishing: number;
  /** How many domains were declared at all. */
  total: number;
}

/** Read the baseline's `silent` array, or `null` when the file is absent. */
function readBaseline(path: string): string[] | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { silent?: string[] };
  return parsed.silent ?? [];
}

/**
 * The shrink-only ratchet, in both directions.
 *
 * A NEW silent domain is refused, so a domain cannot be grandfathered; and a baseline
 * entry that now publishes must be deleted, so paying the debt is permanent. Adding the
 * publisher is never enough on its own — the line has to go.
 */
function ratchetProblems(silent: readonly string[], baselinePath: string): string[] {
  const baseline = readBaseline(baselinePath);
  if (baseline === null) {
    return [`missing baseline ${baselinePath} — create it with the current silent set`];
  }
  const problems: string[] = [];
  const added = silent.filter((entry) => !baseline.includes(entry));
  if (added.length > 0) {
    problems.push(
      `these domains became silent, and the list may only shrink: ${added.join(", ")}. ` +
        `Give them a publisher instead of grandfathering them.`,
    );
  }
  const removed = baseline.filter((entry) => !silent.includes(entry));
  if (removed.length > 0) {
    problems.push(
      `${baselinePath} still lists ${removed.join(", ")}, which now publish — ` +
        `remove those entries so the ratchet cannot slip back`,
    );
  }
  return problems;
}

/** Every `publishes` claim that is not backed by a module which really emits. */
function declarationProblems(
  declarations: readonly PublisherEntry[],
  root: string,
): string[] {
  const problems: string[] = [];
  for (const { scheme, domain, declaration } of declarations) {
    if (declaration.kind !== "publishes") continue;
    const modulePath = resolve(root, declaration.module);
    if (!existsSync(modulePath)) {
      problems.push(
        `${scheme}:${domain} declares publisher "${declaration.module}", which does not exist`,
      );
      continue;
    }
    if (!EMIT_CALL.test(readFileSync(modulePath, "utf8"))) {
      problems.push(
        `${scheme}:${domain} declares publisher "${declaration.module}", ` +
          `but that module never calls publishRealtimeEvent`,
      );
    }
  }
  return problems;
}

export function runPublisherParity(options: PublisherParityOptions): PublisherParityResult {
  const declarations = options.declarations ?? FUTURE_PAY_PUBLISHER_DECLARATIONS;
  const baselinePath = resolve(options.root, options.baselineFile ?? DEFAULT_SILENT_BASELINE);

  const silent = declarations
    .filter(({ declaration }) => declaration.kind === "silent")
    .map(({ scheme, domain }) => `${scheme}:${domain}`)
    .sort();

  const problems = [
    // Zero declarations would make every check below vacuously green — the exact shape of
    // the failure this gate exists to catch.
    ...(declarations.length === 0
      ? ["no publisher declarations were provided — is the host's map intact?"]
      : []),
    ...declarationProblems(declarations, options.root),
    ...ratchetProblems(silent, baselinePath),
  ];

  return {
    ok: problems.length === 0,
    problems,
    silent,
    publishing: declarations.length - silent.length,
    total: declarations.length,
  };
}

/**
 * The CLI wrapper: run the gate, print, and exit non-zero on a violation.
 *
 * A host's `scripts/realtime/publisher-gate.ts` becomes exactly this call, which is what
 * lets the existing `Realtime Publisher Parity` CI job — which shells out to the
 * consumer's own package script — keep working with no change to the workflow.
 */
export function publisherParityCli(options: PublisherParityOptions): void {
  const result = runPublisherParity(options);

  if (!result.ok) {
    console.error("[realtime-publisher-gate] FAILED:");
    for (const problem of result.problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }

  console.log(
    `[realtime-publisher-gate] ok — ${result.publishing}/${result.total} domains publish; ` +
      `${result.silent.length} still silent (${result.silent.join(", ") || "none"}).`,
  );
}
