/**
 * The job registry: `defineJob` at module scope, jobs collected by import.
 *
 * Same open/closed seam as the notification generators — a domain module
 * declares its jobs next to the code they belong to, and the worker bootstrap
 * only has to import those modules. Nothing central lists them.
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
 * Declare a job and register it under its name.
 *
 * Throws on a duplicate name rather than replacing: two modules quietly
 * claiming one name means one of them never runs, and a schedule installed
 * under that name would fire the wrong handler. (The notification registry
 * replaces on re-register, which is right for *content* generators and wrong
 * for *execution*.)
 */
export function defineJob<TPayload = void>(
  definition: JobDefinition<TPayload>,
): RegisteredJob<TPayload> {
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

/** Test-only: drop every registration (isolation between suites). */
export function clearJobs(): void {
  registry.clear();
}
