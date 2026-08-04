import { ShiftError } from './errors';
import type {
  AutoCloseFailure,
  AutoCloseInput,
  AutoCloseResult,
  CloseShiftInput,
  Shift,
  ShiftDb,
} from './types';

/** Close a stored shift, optionally asserting the owner. Supplied by the service. */
export type CloseStoredShift = (
  input: CloseShiftInput,
  expectedUserId?: string,
) => Promise<Shift>;

function isConcurrentClose(error: unknown): boolean {
  return (
    error instanceof ShiftError &&
    (error.code === 'SHIFT_ALREADY_ENDED' || error.code === 'SHIFT_NOT_FOUND')
  );
}

async function autoCloseCandidate(
  shift: Shift,
  detectedAt: Date,
  input: AutoCloseInput,
  closeShift: CloseStoredShift,
): Promise<Shift | null> {
  const durationMs = await input.maxDurationMsForTenant(shift.clientId);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new ShiftError(
      'INVALID_SHIFT',
      `The auto-close duration for tenant ${shift.clientId} must be positive.`,
    );
  }
  const cutoff = new Date(shift.startedAt.getTime() + durationMs);
  if (cutoff > detectedAt) return null;
  try {
    return await closeShift({
      clientId: shift.clientId,
      shiftId: shift.id,
      byUserId: null,
      reason: 'auto',
      endedAt: cutoff,
    });
  } catch (error) {
    if (isConcurrentClose(error)) return null;
    throw error;
  }
}

function toFailure(shift: Shift, error: unknown): AutoCloseFailure {
  if (error instanceof ShiftError) {
    return {
      clientId: shift.clientId,
      shiftId: shift.id,
      code: error.code,
      message: error.message,
    };
  }
  return {
    clientId: shift.clientId,
    shiftId: shift.id,
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Sweep every tenant's overdue shifts.
 *
 * The sweep is CROSS-TENANT and its job runs with `attempts: 1`, so a single
 * poisoned row must not decide the fate of every other tenant's shifts: one row
 * that cannot be closed (a released assignment, a corrupt end state) would
 * otherwise abort the loop and wedge auto-close platform-wide, forever and
 * silently. Each candidate is therefore isolated, and every failure is reported
 * back so the caller can log it and a stuck row stays observable.
 */
export async function autoCloseOverdue(
  db: ShiftDb,
  input: AutoCloseInput,
  detectedAt: Date,
  closeShift: CloseStoredShift,
): Promise<AutoCloseResult> {
  const candidates = await db.listOpenStartedBefore(detectedAt);
  const closed: Shift[] = [];
  const failures: AutoCloseFailure[] = [];
  for (const shift of candidates) {
    try {
      const result = await autoCloseCandidate(shift, detectedAt, input, closeShift);
      if (result) closed.push(result);
    } catch (error) {
      failures.push(toFailure(shift, error));
    }
  }
  return { closed, failures };
}
