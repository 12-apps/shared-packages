/**
 * `defineJobModule` — how a PACKAGE exposes background work.
 *
 * This is the worker counterpart of an endpoint mount, and it exists for the
 * same reason that one does. A package that owns a domain owns the DEFERRED
 * half of it too: the sweep that finishes what a request could not, the watcher
 * that waits for a callback, the expiry that stops waiting. Left to each host,
 * that half gets rewritten per adopter — and every rewrite is a place the
 * behaviour can differ, which is exactly what happened to the payments
 * reconciliation: one host had it, the others silently did not.
 *
 * ## The problem this solves
 *
 * `defineJob` registers at MODULE SCOPE. That is right for a host's own jobs,
 * where the handler can close over whatever it needs, and impossible for a
 * package's: a package cannot know the host's database client, gateway or
 * logger at import time, and must not reach for a global to find them.
 *
 * So a package declares BLUEPRINTS — everything about a job except the deps —
 * and the host supplies the deps at mount:
 *
 *     // in the package
 *     export const paymentsJobs = defineJobModule<PaymentsJobDeps>()({
 *       namespace: "payments",
 *       jobs: { watchSettlement, expireWatches },
 *     });
 *
 *     // in the host, beside the endpoint mount it already writes
 *     const { jobs } = paymentsJobs.mount({ gateway, store, logger });
 *     createApiJobs({ jobs: [...jobs, ...ownJobs] });
 *
 * The host's line is the whole integration. It cannot get the retry policy,
 * the schedule, the queue or the concurrency wrong, because it is not asked
 * for them — the same reason `mountPayments` does not ask a host which HTTP
 * methods a settings route answers.
 *
 * ## Enqueueing without the deps
 *
 * A package's own code has to be able to enqueue its own jobs — a charge is
 * raised, and something must start watching it — long after `mount` ran and
 * from a module that holds no deps. `enqueue` is therefore a LAZY handle: it
 * resolves through the registry by name at call time, exactly as an emit site
 * does, so it works from anywhere and needs nothing threaded through.
 *
 *     await paymentsJobs.enqueue.watchSettlement({ chargeId }, { dedupeKey });
 *
 * Enqueueing before `mount` reports `unregistered` rather than throwing — the
 * same answer `enqueueJob` gives for any unknown name, and the same reason: a
 * deferred side effect must never take down the request that scheduled it. A
 * host that forgot to mount sees it in the log and in the skip reason, while
 * the durable row the job was paired with is still there for the sweep.
 *
 * ## Names are namespaced here, once
 *
 * A blueprint states its own short name (`watch-settlement`) and this prepends
 * the namespace (`payments.watch-settlement`). The wire key is then derived in
 * one place rather than spelled in each declaration, so two packages cannot
 * collide by both calling something `drain`, and a host reading its queue
 * dashboard can tell whose work it is looking at.
 */

import { defineJob, resolveRegisteredJob, type RegisteredJob } from "./registry";
import { enqueueJob, getJobLogger } from "./runtime";
import type {
  EnqueueOptions,
  EnqueueResult,
  JobBackoff,
  JobContext,
  JobSchedule,
} from "./types";

/**
 * One job a package declares, with its deps left open.
 *
 * Everything `JobDefinition` carries except `name` (namespaced at mount) and
 * `handle`, whose signature gains the host-supplied deps. A blueprint is inert
 * data: declaring one registers nothing and starts nothing.
 */
export interface JobBlueprint<TPayload, TDeps> {
  /**
   * Short name within the module — `watch-settlement`, not
   * `payments.watch-settlement`. The namespace is prepended at mount.
   */
  name: string;
  queue?: string;
  attempts?: number;
  backoff?: JobBackoff;
  schedule?: JobSchedule;
  concurrency?: number;
  /**
   * The work. Takes the host's deps as its second argument, which is the only
   * difference from a plain {@link JobDefinition} handler — the payload rule
   * and the idempotency contract are unchanged and still apply.
   */
  handle: (payload: TPayload, deps: TDeps, context: JobContext) => Promise<void>;
}

/** A record of blueprints, keyed by however the package refers to them. */
export type JobBlueprints<TDeps> = Readonly<
  Record<string, JobBlueprint<never, TDeps>>
>;

/** The payload a blueprint carries, recovered for the enqueue signature. */
type PayloadOf<TBlueprint> =
  TBlueprint extends JobBlueprint<infer TPayload, never> ? TPayload : never;

/**
 * What `mount` answers: the registered jobs, ready to hand to `createApiJobs`.
 *
 * An object rather than a bare array, and for the same reason
 * `MountedPaymentsRoutes` is one: a mount grows things a host needs alongside
 * the primary artefact, and widening an object is not a breaking change.
 */
export interface MountedJobs {
  /** Pass straight to `createApiJobs({ jobs })`, spread beside the host's own. */
  readonly jobs: readonly RegisteredJob<never>[];
  /** The wire names this mount registered — for a host's own health output. */
  readonly names: readonly string[];
}

/** The lazy enqueuers, one per blueprint, keyed as the blueprints were. */
export type JobModuleEnqueue<TBlueprints> = {
  readonly [K in keyof TBlueprints]: (
    payload: PayloadOf<TBlueprints[K]>,
    options?: EnqueueOptions,
  ) => Promise<EnqueueResult>;
};

/** A package's deferred surface: mount it once, enqueue from anywhere. */
export interface JobModule<TDeps, TBlueprints extends JobBlueprints<TDeps>> {
  /** `payments`, `notifications`, … — the prefix on every name this owns. */
  readonly namespace: string;
  /** Register every job with the host's deps bound in. Call once per process. */
  mount(deps: TDeps): MountedJobs;
  /** Defer one run, resolved through the registry at call time. */
  readonly enqueue: JobModuleEnqueue<TBlueprints>;
  /** The wire name of a blueprint, for logs and dedupe keys. */
  nameOf(key: keyof TBlueprints): string;
}

/**
 * Declare a package's deferred surface.
 *
 * Curried so the deps type is stated once and every blueprint is checked
 * against it, while the blueprint record's own keys and payload types stay
 * inferred — TypeScript cannot do both in one call.
 */
export function defineJobModule<TDeps>() {
  return function build<TBlueprints extends JobBlueprints<TDeps>>(options: {
    namespace: string;
    jobs: TBlueprints;
  }): JobModule<TDeps, TBlueprints> {
    const { namespace, jobs } = options;
    assertNamespace(namespace);
    const keys = Object.keys(jobs) as (keyof typeof jobs)[];
    const wireName = (key: keyof typeof jobs): string =>
      `${namespace}.${jobs[key]?.name ?? String(key)}`;

    return {
      namespace,
      nameOf: wireName,

      mount(deps: TDeps): MountedJobs {
        const registered = keys.map((key) => {
          const blueprint = jobs[key] as JobBlueprint<never, TDeps>;
          return defineJob<never>({
            name: wireName(key),
            ...(blueprint.queue === undefined ? {} : { queue: blueprint.queue }),
            ...(blueprint.attempts === undefined ? {} : { attempts: blueprint.attempts }),
            ...(blueprint.backoff === undefined ? {} : { backoff: blueprint.backoff }),
            ...(blueprint.schedule === undefined ? {} : { schedule: blueprint.schedule }),
            ...(blueprint.concurrency === undefined
              ? {}
              : { concurrency: blueprint.concurrency }),
            handle: (payload, context) => blueprint.handle(payload, deps, context),
          });
        });
        return {
          jobs: registered,
          names: registered.map((job) => job.name),
        };
      },

      enqueue: Object.fromEntries(
        keys.map((key) => [
          key,
          // Resolved at CALL time, not at mount: this handle is what the
          // package's own emit sites hold, and they are imported long before
          // (and often without) the mount that binds the deps.
          async (payload: never, enqueueOptions?: EnqueueOptions) => {
            const name = wireName(key);
            const definition = resolveRegisteredJob(name);
            if (!definition) return unmounted(name);
            return enqueueJob(definition, payload, enqueueOptions);
          },
        ]),
      ) as JobModuleEnqueue<TBlueprints>,
    };
  };
}

/**
 * A namespace that cannot silently produce a bad wire name.
 *
 * A blank one yields `.watch-settlement`, which registers, schedules and runs
 * — and is indistinguishable in a queue dashboard from another package's. A
 * dot inside one yields a name with two, which no host can parse back.
 */
function assertNamespace(namespace: string): void {
  if (typeof namespace !== "string" || namespace.trim() === "") {
    throw new TypeError("defineJobModule: `namespace` must be a non-empty string.");
  }
  if (namespace.includes(".")) {
    throw new TypeError(
      `defineJobModule: \`namespace\` must not contain a dot, got "${namespace}".`,
    );
  }
}

/**
 * The answer for an enqueue that arrived before `mount` — or without one.
 *
 * A skip rather than a throw, because this is reached from wherever the
 * package's domain happens to enqueue: a charge being raised, a webhook being
 * accepted. Those are request paths, and a wiring mistake in the deferred half
 * must not fail the money path in front of it. The log line is what makes the
 * mistake findable; `unregistered` is what `enqueueJob` itself answers for the
 * same condition, so a caller has one reason code to handle, not two.
 */
function unmounted(name: string): EnqueueResult {
  getJobLogger().error(
    `"${name}" was not enqueued: its job module is not mounted in this process. ` +
      "Call the module's mount() and pass its jobs to createApiJobs({ jobs }).",
  );
  return { enqueued: false, reason: "unregistered" };
}
