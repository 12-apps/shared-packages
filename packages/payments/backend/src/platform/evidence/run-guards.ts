import type { EvidenceRunDeps, sandboxSeller } from "./run";
import type { EvidenceRecord } from "./types";

const PROVIDER = "pagbank";

/**
 * Thrown when phase 2 names a run that is not the latest prepared one, or one
 * whose orders were already raised. A second phase 2 on the same run would
 * replay idempotent creates that make no call, and overwrite the recording
 * that did — so a run raises its orders exactly once.
 */
export class EvidenceRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No open homologation evidence run ${runId}`);
    this.name = "EvidenceRunNotFoundError";
  }
}

/** The latest run, provided it is this one. */
export function openRun(
  record: EvidenceRecord | null,
  runId: string,
): EvidenceRecord {
  if (!record || record.id !== runId) throw new EvidenceRunNotFoundError(runId);
  return record;
}

/** Re-read this run as it stands now, for a save that merges into it. */
export const readRun =
  (deps: EvidenceRunDeps, runId: string) => async (): Promise<EvidenceRecord> =>
    openRun(await deps.store.latest(PROVIDER, "RUN"), runId);

/** Why phase 2 may not raise orders for this run, or null when it may. */
export function blockedBecause(
  deps: EvidenceRunDeps,
  record: EvidenceRecord,
  seller: Awaited<ReturnType<typeof sandboxSeller>>,
): string | null {
  if (seller === "NOT_SANDBOX") return deps.copy.notSandbox;
  if (seller === "NOT_CONNECTED") return deps.copy.usageNotConnected;
  if (!deps.customer) return deps.copy.buyerMissing;
  return (
    record.steps.find(
      (step) => step.key === "connect.usage" && step.status === "FAILED",
    )?.observed ?? null
  );
}
