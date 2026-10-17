import type { RecordedHttpCall } from '../../core/traffic-recorder';
import type { RecordedOutcome } from './record';
import type {
  EvidenceOutcomeCopy,
  EvidenceStatus,
  EvidenceStep,
  EvidenceStepKey,
  EvidenceSummary,
} from './types';

/** A step with nothing recorded yet — the honest default for anything not run. */
export function pendingStep(key: EvidenceStepKey, copy: EvidenceOutcomeCopy, observed?: string): EvidenceStep {
  return { key, status: 'PENDING', at: null, calls: [], notes: [], ids: {}, observed: observed ?? copy.notRun };
}

export function stepOf(
  key: EvidenceStepKey,
  status: EvidenceStatus,
  at: Date,
  fields: { observed: string; calls?: RecordedHttpCall[]; notes?: string[]; ids?: Record<string, string> },
): EvidenceStep {
  return {
    key,
    status,
    at: at.toISOString(),
    calls: fields.calls ?? [],
    notes: fields.notes ?? [],
    ids: fields.ids ?? {},
    observed: fields.observed,
  };
}

/** Cap on an error message kept as evidence — enough to diagnose. */
const MAX_DETAIL = 300;

/**
 * An error as evidence. Provider errors carry PagBank's own body excerpt,
 * which is the diagnosis; nothing here can carry a secret, because the
 * adapters never put a credential in a message.
 */
export function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);
}

/** The last recorded answer's HTTP status, when there was one. */
export function lastStatus(calls: readonly RecordedHttpCall[]): number | undefined {
  return calls.at(-1)?.status;
}

export function isSuccess(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

export function summarize(steps: readonly EvidenceStep[]): EvidenceSummary {
  const count = (status: EvidenceStatus): number => steps.filter((step) => step.status === status).length;
  return { executed: count('EXECUTED'), failed: count('FAILED'), pending: count('PENDING') };
}

/** Replace (or add) one step of a record, keeping the canonical order stable. */
export function withStep(steps: readonly EvidenceStep[], next: EvidenceStep): EvidenceStep[] {
  return [...steps.filter((step) => step.key !== next.key), next];
}

/** The step's clock — injectable for tests. */
export const clockOf = (deps: { now?: () => Date }): (() => Date) => deps.now ?? (() => new Date());

/** Whether PagBank actually answered 2xx to a call this step recorded. */
export function answered(calls: readonly RecordedHttpCall[]): boolean {
  return calls.some((call) => isSuccess(call.status));
}

/** A failed or unexpected answer, in the copy's words. */
export function failureOf(copy: EvidenceOutcomeCopy, outcome: RecordedOutcome<unknown>): string {
  if (!outcome.ok) return copy.callError(errorDetail(outcome.error));
  const status = lastStatus(outcome.calls);
  return status === undefined ? copy.notAsExpected : copy.httpAnswered(status);
}
