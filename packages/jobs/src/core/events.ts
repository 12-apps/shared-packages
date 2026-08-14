import type { JobEvents, JobLogger } from "./types";

/**
 * The observer plumbing, in ONE place because both drivers need it and the
 * rule is easy to get subtly wrong twice: a `JobEvents` hook is somebody
 * else's code, and it must never be able to fail the job it is watching, nor
 * the reconcile that was cleaning up a stale schedule.
 *
 * Both failure modes are covered, and they are not the same one: a hook can
 * THROW synchronously, and an async hook can REJECT later. Catching only the
 * first leaves an unhandled rejection that some Node configurations turn into
 * a process exit — a notifier outage taking the worker down with it, which is
 * exactly backwards.
 *
 * Fire-and-forget by design: the job's own latency must not include whatever
 * a host's notifier decides to do.
 */
export type EmitJobEvent = (emit: (events: JobEvents) => void | Promise<void>) => void;

export function createEventEmitter(
  events: JobEvents | undefined,
  logger: JobLogger,
): EmitJobEvent {
  if (!events) return () => undefined;
  return (emit) => {
    try {
      void Promise.resolve(emit(events)).catch((error: unknown) =>
        logger.error("a jobs event observer rejected:", error),
      );
    } catch (error) {
      logger.error("a jobs event observer threw:", error);
    }
  };
}
