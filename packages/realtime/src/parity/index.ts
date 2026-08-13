import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `@12-apps/realtime/parity` — the publisher-parity gate (12-16), moved out of
 * future-pay's `apps/web/scripts/realtime/publisher-gate.ts` so a host's own script is a
 * one-line re-export and the CI job that shells out to a package script keeps working
 * unchanged. Packaged the same way `@12-apps/rbac/coverage` is: a library plus a CLI
 * wrapper — except that the host's lists are INPUTS here rather than defaults, for the
 * reason under "What this checks" below.
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
 * ## What this checks
 *
 *   1. **COMPLETENESS.** Every domain a host says is subscribable must have a
 *      declaration. See {@link PublisherParityOptions.domains} for why this is an input
 *      of the gate rather than a property the compiler is trusted to hold.
 *   2. A `publishes` module must exist and actually call `publishRealtimeEvent`.
 *      Otherwise the declaration is just a second place to be wrong.
 *   3. The set of `silent` domains may only SHRINK against the baseline file — the same
 *      ratchet as `.quality-exceptions`. Debt can be paid down, never grown. It fails in
 *      BOTH directions: a new silent domain is refused, and a baseline entry that now
 *      publishes must be deleted, so paying the debt is permanent.
 *
 * A completeness gate whose own completeness is assumed is not one, which is what this
 * module got wrong on its first pass: it took an ARRAY of declarations, defaulted it to a
 * copy of future-pay's, and rested on "a host declares its publishers as
 * `Record<Domain, PublisherDeclaration>`, so the COMPILER already forces every domain to
 * appear". That property does not survive the array boundary and it did not survive the
 * package boundary either — add a domain to the host's registry and the gate stayed green
 * while the screen said "Ao vivo" and received nothing, i.e. FUT-440 again, past the gate
 * built to prevent it. When a completeness gate's filter misses, the result is not a red
 * run but NO run.
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
 *
 * Tested against {@link stripComments}, never raw text: a docstring saying
 * `publishRealtimeEvent(topic, …)` is not a publisher, and in this codebase's docstring
 * style it is the LIKELY residue of a module whose emit was refactored out. Same
 * fail-open class as the comment-defeated brace scan this repo has already shipped twice.
 */
const EMIT_CALL = /\bpublishRealtimeEvent\s*(?:<[^>]*>)?\s*\(/;

/**
 * Blank out `//` and block comments, keeping the rest byte-for-byte.
 *
 * A local ~15-line stripper rather than `@12-apps/rbac`'s `stripCommentsAndStrings`: that
 * one is real and hardened, and reaching it would mean this package depending on the RBAC
 * package to read a file — a dependency the wrong way round for a realtime gate. Strings
 * are deliberately LEFT INTACT: nothing here needs them gone, and a stripper that eats
 * quotes has to get escapes and template literals right to avoid swallowing live code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Where the ratchet lives, relative to the repo root. */
export const DEFAULT_SILENT_BASELINE = ".realtime-silent-domains.json";

/**
 * future-pay's own declarations — an EXAMPLE, and deliberately not a default.
 *
 * It was a fallback for `declarations` in this gate's first version, for the same reason
 * `@12-apps/rbac/coverage` ships `FUTURE_PAY_RBAC_GUARDS`: zero-configuration adoption for
 * a host with the future-pay layout. That is exactly what made the gate fail OPEN — a host
 * that adds a domain to its registry and forgets the map got a green run out of a seven-
 * entry copy of somebody else's domains. A completeness gate cannot supply its own subject.
 *
 * So it is exported to be READ (a shape to copy, and the harness's fixture material) and
 * nothing consumes it implicitly. The module paths are repo-relative and resolved against
 * the caller's `root`.
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

/** Every domain a host's subscribe surfaces will authorize, per topic scheme. */
export interface PublisherParityDomains {
  readonly tenant: readonly string[];
  readonly user: readonly string[];
}

export interface PublisherParityOptions {
  /** Repo root every declared module path is resolved against. */
  root: string;
  /**
   * The host's declarations, one per subscribable domain.
   *
   * REQUIRED, with no shipped fallback: a default meant this gate could run against
   * somebody else's domain list and report green — see
   * {@link FUTURE_PAY_PUBLISHER_DECLARATIONS}. Build it from the host's own
   * `Record<Domain, PublisherDeclaration>` so the compiler keeps forcing every domain to
   * appear THERE too; `domains` below is what makes the gate assert it rather than assume
   * it.
   */
  declarations: readonly PublisherEntry[];
  /**
   * Every domain that can be SUBSCRIBED to — the host's own registry, the list its
   * `createApiEvents` surfaces are configured with.
   *
   * REQUIRED, and the reason is the whole finding: a domain is AUTHORIZABLE the moment it
   * is registered, and nothing requires it to have an emitter. Handing the gate an array
   * of declarations and nothing else means a missing declaration is not a violation, it is
   * SILENCE — the screen connects, is told it is live, relaxes its poll to 30 s and hears
   * nothing. Passing the registry restores the completeness check INSIDE the gate, where
   * it cannot be dropped by a host that builds its array a different way.
   *
   * Note the asymmetry: a domain here with no declaration is a violation, and a
   * declaration for a domain not here is NOT. Publishing to a topic nobody can subscribe
   * to is legitimate (an internal or system topic); being subscribable with nothing to
   * hear is the failure.
   */
  domains: PublisherParityDomains;
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
    if (!EMIT_CALL.test(stripComments(readFileSync(modulePath, "utf8")))) {
      problems.push(
        `${scheme}:${domain} declares publisher "${declaration.module}", ` +
          `but that module never calls publishRealtimeEvent`,
      );
    }
  }
  return problems;
}

/**
 * Every subscribable domain that declares nothing at all — the COMPLETENESS half.
 *
 * The one check the package boundary took away. A declaration array cannot report what is
 * missing from it, so the registry has to be handed in and compared against.
 */
function coverageProblems(
  declarations: readonly PublisherEntry[],
  domains: PublisherParityDomains,
): string[] {
  const declared = new Set(declarations.map(({ scheme, domain }) => `${scheme}:${domain}`));
  const missing = (["tenant", "user"] as const).flatMap((scheme) =>
    domains[scheme]
      .map((domain) => `${scheme}:${domain}`)
      .filter((entry) => !declared.has(entry)),
  );
  if (missing.length === 0) return [];
  return [
    `these domains are subscribable and declare no publisher at all: ${missing.join(", ")}. ` +
      `A domain nobody declared is a screen that connects, is told it is live, slows its ` +
      `poll and hears nothing — declare its publisher, or declare it silent and ratchet it.`,
  ];
}

export function runPublisherParity(options: PublisherParityOptions): PublisherParityResult {
  // Both are REQUIRED in the type. Coalesced anyway, and coalesced to EMPTY, for a host
  // whose gate script is plain JavaScript: nothing to check then trips the vacuous-pass
  // guard below, which is a red run with an actionable message. The default this replaced
  // was a seven-entry copy of future-pay's domains, and that failed OPEN — which is the
  // difference that matters, not whether there is a default at all.
  const declarations = options.declarations ?? [];
  const domains = options.domains ?? { tenant: [], user: [] };
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
    ...coverageProblems(declarations, domains),
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
