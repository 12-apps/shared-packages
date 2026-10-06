import type { SlotStandingInput, ShiftSlotStandingResult } from './schedule-types';

const MINUTE_MS = 60_000;

/**
 * Where a slot stands at `now` — total over every input, evaluated in order:
 *
 * 1. `canceled` — the slot was canceled;
 * 2. `over` — its end has passed;
 * 3. `on_shift` — the host passed the open shift that counts, and the slot is
 *    within its due window or under way;
 * 4. `late` — its start has passed and no counting shift is open;
 * 5. `due` — its start is within the due window;
 * 6. `later` — otherwise.
 *
 * Pure: the host decides which open shift counts (for example, one of the
 * slot's kind) and passes it, or null.
 */
export function slotStandingAt(
  input: SlotStandingInput & { now: Date },
  dueWindowMinutes: number,
): ShiftSlotStandingResult {
  const { slot, openShift, now } = input;
  const at = now.getTime();
  const startMs = slot.startsAt.getTime();
  const dueFrom = startMs - dueWindowMinutes * MINUTE_MS;
  if (slot.canceledAt !== null) return { standing: 'canceled', lateMinutes: 0 };
  if (at >= slot.endsAt.getTime()) return { standing: 'over', lateMinutes: 0 };
  if (openShift !== null && at >= dueFrom) return { standing: 'on_shift', lateMinutes: 0 };
  if (at >= startMs) {
    return { standing: 'late', lateMinutes: Math.floor((at - startMs) / MINUTE_MS) };
  }
  if (at >= dueFrom) return { standing: 'due', lateMinutes: 0 };
  return { standing: 'later', lateMinutes: 0 };
}
