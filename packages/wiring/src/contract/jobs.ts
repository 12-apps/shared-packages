/**
 * The WORKERS capability: dependency-free job blueprints.
 *
 * `@12-apps/jobs` already owns this seam (`defineJobModule`): a package
 * declares everything about a job EXCEPT the deps, and the host binds the
 * deps once at mount. `@12-apps/payments-backend` restates the same shape by
 * hand (`PaymentsJobBlueprint`) because it must stay installable without
 * `@12-apps/jobs` — and nothing type-checks the two against each other, which
 * is exactly the gap a zero-dependency contract package closes: both sides
 * declare against THIS shape, and a compat test in each package pins the
 * assignability (`jobs-compat.test.ts` here pins `@12-apps/jobs`'s side).
 *
 * Every interface below is a structural twin of the `@12-apps/jobs` original
 * of the same name, field for field.
 */

/** Twin of `@12-apps/jobs`' `JobLogger`. */
export interface WireJobLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/** Twin of `JobBackoff`: retry spacing after a failed attempt. */
export interface WireJobBackoff {
  type: "exponential" | "fixed";
  delayMs: number;
}

/** Twin of `JobSchedule`: a cron schedule for a repeatable job. */
export interface WireJobSchedule {
  /** Standard 5-field cron (6-field with seconds accepted). */
  pattern: string;
  /** IANA timezone the pattern is evaluated in. Defaults to UTC. */
  timezone?: string;
}

/** Twin of `JobContext`: what a handler is told about the attempt. */
export interface WireJobContext {
  runId: string;
  /** 1-based. `attempt === maxAttempts` means this is the last chance. */
  attempt: number;
  maxAttempts: number;
  logger: WireJobLogger;
}

/**
 * A sub-minute cadence — what cron cannot say. A realtime outbox drains
 * every ten seconds; a 5-field pattern bottoms out at one minute. A
 * blueprint declares EITHER a `schedule` or an `interval`, never both.
 * A host whose runtime cannot repeat sub-minute must decline the jobs
 * binding rather than silently rounding up.
 */
export interface WireJobInterval {
  everyMs: number;
}

/**
 * A single-flight lease around the handler — the `withSweepLease` shape
 * hosts wrap sweeps in by hand today. Declared, the HOST's runner owns the
 * wrapping; the ttl is the package's claim about how long one run may hold
 * the name.
 */
export interface WireJobLease {
  ttlMs: number;
}

/**
 * Twin of `JobBlueprint`: one job a package declares, deps left open.
 * Inert data — declaring one registers nothing and starts nothing.
 *
 * A handler needing a HOST-COMPUTED argument (a retention window cut from a
 * billing watermark, a per-tenant duration) does not get a field here: that
 * argument is a dep. The host closes it over at bind time — a function dep
 * the handler calls per run — which keeps the blueprint inert and the
 * computation where the vocabulary lives.
 */
export interface WireJobBlueprint<TPayload, TDeps> {
  /** Short name within the module — namespaced at bind time. */
  name: string;
  queue?: string;
  /** Total attempts including the first. Defaults to 1 (no retry). */
  attempts?: number;
  backoff?: WireJobBackoff;
  /** Present ⇒ the job also runs on a schedule, with no payload. */
  schedule?: WireJobSchedule;
  /** Present ⇒ the job repeats sub-minute. Mutually exclusive with `schedule`. */
  interval?: WireJobInterval;
  /** Present ⇒ the host's runner must hold this single-flight lease per run. */
  lease?: WireJobLease;
  concurrency?: number;
  handle(payload: TPayload, deps: TDeps, context: WireJobContext): Promise<void>;
}

/**
 * The producer side of the capability: a namespace plus the blueprints under
 * it. The namespace is prepended once at bind time (`payments.watch`), so two
 * packages cannot collide by both calling something `drain`.
 */
export interface JobsContribution<TDeps> {
  /** `payments`, `notifications`, … — no dots; the wire-name prefix. */
  namespace: string;
  blueprints: Readonly<Record<string, WireJobBlueprint<never, TDeps>>>;
}

/**
 * One blueprint after binding: deps closed over, name namespaced. A structural
 * twin of `@12-apps/jobs`' `JobDefinition`, so a host's whole integration is
 *
 *     createApiJobs({ jobs: () => assembled.jobs.map((job) => defineJob(job)) })
 *
 * — one line for every adopted package, with `defineJob` still running its own
 * name/schedule validation exactly as it does for the host's own jobs.
 */
export interface BoundJob {
  /** Dot-namespaced and stable: the wire key and the scheduler id. */
  name: string;
  queue?: string;
  attempts?: number;
  backoff?: WireJobBackoff;
  schedule?: WireJobSchedule;
  /**
   * Carried through from the blueprint. `defineJob` ignores both (extra
   * optional properties survive the structural assignment) — a host runner
   * that supports sub-minute repeats or leases reads them off the bound job;
   * one that does not should have declined the binding.
   */
  interval?: WireJobInterval;
  lease?: WireJobLease;
  concurrency?: number;
  handle(payload: never, context: WireJobContext): Promise<void>;
}
