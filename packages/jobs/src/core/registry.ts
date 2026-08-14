/**
 * The job registry: `defineJob` at module scope, jobs collected by import.
 *
 * An open/closed seam — a domain module declares its jobs next to the code
 * they belong to, and the worker bootstrap only has to import those modules.
 * Nothing central lists them.
 *
 * The registry is also THE GATE. `resolveRegisteredJob` is the one question
 * both halves of the system ask — the enqueue side before it writes, the
 * execution side before it runs — so the two cannot drift into a state where
 * a write is accepted that the run side will refuse.
 */

import type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  JobDefinition,
} from "./types";

/** A defined job: its declaration, plus the typed way to enqueue one. */
export interface RegisteredJob<TPayload> {
  readonly name: string;
  readonly definition: JobDefinition<TPayload>;
  /** Defer one run. Never throws — see {@link EnqueueResult}. */
  enqueue(payload: TPayload, options?: EnqueueOptions): Promise<EnqueueResult>;
}

const registry = new Map<string, AnyJobDefinition>();

/** Raised for a duplicate job name — always a programming error. */
export class DuplicateJobError extends Error {
  constructor(name: string) {
    super(`A job named "${name}" is already defined.`);
    this.name = "DuplicateJobError";
  }
}

/**
 * Raised for a definition that cannot run as written — a blank name, an empty
 * queue, a cron pattern no scheduler will ever fire.
 *
 * Every one of these fails SILENTLY if it is let through: an empty queue name
 * creates a queue nobody consumes, `attempts: 0` means one attempt in one
 * driver and none in another, and a blank pattern installs a scheduler that
 * never fires — a sweep that simply stops happening, with nothing logged and
 * nothing failed. So they are refused at assembly, where the stack trace still
 * points at the declaration.
 */
export class InvalidJobDefinitionError extends Error {
  constructor(name: string, detail: string) {
    super(`Job "${name}" is not valid: ${detail}`);
    this.name = "InvalidJobDefinitionError";
  }
}

/**
 * Raised when a process is asked to run jobs and NOT ONE is registered.
 *
 * "Declare nothing" must not resolve to "accept anything": with an empty
 * registry a worker starts, consumes no queue, installs no schedule and
 * reports itself healthy — every scheduled sweep in the deployment silently
 * stops, and nothing fails to show it. A host with no jobs has no use for this
 * package at all, so an empty registry is always a wiring mistake.
 */
export class NoJobsRegisteredError extends Error {
  constructor(where: string) {
    super(
      `${where}: no jobs are registered. Import the modules that call defineJob ` +
        "(the import IS the registration), or list them in `jobs`.",
    );
    this.name = "NoJobsRegisteredError";
  }
}

function assertText(name: string, field: string, value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidJobDefinitionError(name, `\`${field}\` must be a non-empty string.`);
  }
}

function assertPositiveInteger(name: string, field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new InvalidJobDefinitionError(
      name,
      `\`${field}\` must be a positive integer, got ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * Structural cron validation: five fields (or six, with seconds), none blank.
 *
 * Deliberately not a full cron parser — the driver's scheduler owns what a
 * field may contain. What this catches is the class that is invisible at
 * runtime: `""`, `"   "`, `"@daily"` and `"0 *"` all satisfy a `string` type
 * and all produce a schedule that never fires.
 */
function assertCron(name: string, pattern: string): void {
  assertText(name, "schedule.pattern", pattern);
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new InvalidJobDefinitionError(
      name,
      `\`schedule.pattern\` needs 5 fields (or 6 with seconds), got ${fields.length} in "${pattern}".`,
    );
  }
}

function assertBackoff(name: string, backoff: JobDefinition<never>["backoff"]): void {
  if (!backoff) return;
  const { type, delayMs } = backoff;
  if (type !== "exponential" && type !== "fixed") {
    throw new InvalidJobDefinitionError(
      name,
      `\`backoff.type\` must be "exponential" or "fixed", got ${JSON.stringify(type)}.`,
    );
  }
  if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 1) {
    throw new InvalidJobDefinitionError(
      name,
      `\`backoff.delayMs\` must be a positive number of milliseconds, got ${JSON.stringify(delayMs)}.`,
    );
  }
}

/**
 * Refuse a definition that cannot run. Every check here guards a failure that
 * is otherwise silent — see {@link InvalidJobDefinitionError}.
 */
function assertValidDefinition(definition: JobDefinition<never>): void {
  if (typeof definition !== "object" || definition === null) {
    throw new InvalidJobDefinitionError("<unnamed>", "a definition object is required.");
  }
  assertText(String(definition.name), "name", definition.name);
  const { name } = definition;
  if (typeof definition.handle !== "function") {
    throw new InvalidJobDefinitionError(name, "`handle` must be a function.");
  }
  // `queue: ""` is the sharp one: it is not nullish, so it never falls back to
  // the default queue — it creates a queue named "" that no worker consumes.
  if (definition.queue !== undefined) assertText(name, "queue", definition.queue);
  if (definition.attempts !== undefined) {
    assertPositiveInteger(name, "attempts", definition.attempts);
  }
  if (definition.concurrency !== undefined) {
    assertPositiveInteger(name, "concurrency", definition.concurrency);
  }
  assertBackoff(name, definition.backoff);
  if (definition.schedule !== undefined) {
    assertCron(name, definition.schedule.pattern);
    if (definition.schedule.timezone !== undefined) {
      assertText(name, "schedule.timezone", definition.schedule.timezone);
    }
  }
}

/**
 * Declare a job and register it under its name.
 *
 * Throws on a duplicate name rather than replacing: two modules quietly
 * claiming one name means one of them never runs, and a schedule installed
 * under that name would fire the wrong handler.
 *
 * Throws on an unusable definition too, for the same reason — both are silent
 * if let through, and both are programming errors a deployment cannot recover
 * from on its own.
 */
export function defineJob<TPayload = void>(
  definition: JobDefinition<TPayload>,
): RegisteredJob<TPayload> {
  assertValidDefinition(definition as unknown as JobDefinition<never>);
  if (registry.has(definition.name)) throw new DuplicateJobError(definition.name);
  registry.set(definition.name, definition as unknown as AnyJobDefinition);

  return {
    name: definition.name,
    definition,
    async enqueue(payload, options = {}) {
      // Imported lazily: the runtime imports this module, and a static cycle
      // would leave one of the two half-initialized at first use.
      const { enqueueJob } = await import("./runtime");
      return enqueueJob(definition as unknown as AnyJobDefinition, payload, options);
    },
  };
}

/** Every registered definition, in declaration order. */
export function listJobs(): readonly AnyJobDefinition[] {
  return [...registry.values()];
}

/** One definition by name, or `undefined`. */
export function findJob(name: string): AnyJobDefinition | undefined {
  return registry.get(name);
}

/**
 * THE GATE — "may this job run in this deployment?" — and the answer both
 * sides of the queue key on.
 *
 * The enqueue path asks it before a write; the execution path asks it before a
 * run. One function on purpose: restating the rule on each side is how a write
 * comes to be accepted that the run side then refuses, which is the shape of a
 * silent drop — the job lands in the backend, no handler claims it, it
 * dead-letters, and the caller was told `enqueued: true`.
 *
 * Passing a DEFINITION checks identity, not just the name: an impostor object
 * carrying a registered name would ship a payload the real handler never
 * agreed to, and it is not the object a worker holds. Passing a NAME is what
 * the execution side has — a wire key read back off the queue.
 */
export function resolveRegisteredJob(
  job: AnyJobDefinition | string,
): AnyJobDefinition | undefined {
  const name = typeof job === "string" ? job : job.name;
  const registered = registry.get(name);
  if (!registered) return undefined;
  if (typeof job !== "string" && registered !== job) return undefined;
  return registered;
}

/**
 * Refuse an empty registry at the point of use. It takes the caller's name so
 * the message says WHICH entry point was asked — the root `startJobWorkers`
 * and the server factory both reach this, and an operator reading the log
 * needs to know which of the two they wired.
 */
export function assertJobsRegistered(where: string): void {
  if (registry.size === 0) throw new NoJobsRegisteredError(where);
}

/** Test-only: drop every registration (isolation between suites). */
export function clearJobs(): void {
  registry.clear();
}
