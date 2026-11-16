import type { ReportSchedule, ScheduleCadence } from "../../schedule";

/**
 * The schedule as the editor holds and sends it (FUT-776): everything the
 * author chooses, and nothing the server owns (the zone and the fortnight
 * anchor are stamped on save).
 */
export interface ScheduleDraft {
  enabled: boolean;
  cadence: ScheduleCadence;
  /** 0 Sunday … 6 Saturday; read by `weekly` and `biweekly`. */
  weekday: number;
  /** 1 … 31; read by `monthly`. */
  dayOfMonth: number;
  /** `HH:MM`. */
  time: string;
  recipients: string[];
}

/** What a save carries: the draft, without the fields its cadence ignores. */
export interface ReportScheduleWire {
  enabled: boolean;
  cadence: ScheduleCadence;
  weekday?: number;
  dayOfMonth?: number;
  time: string;
  recipients: string[];
}

/** A report's schedule on a stored view: the wire shape plus what the server stamped. */
export type ReportScheduleView = ReportScheduleWire & Pick<ReportSchedule, "timeZone" | "startsOn">;

/** The schedule fields of the save payload and of a parked edit. */
export interface ReportScheduleField {
  /** Omitted keeps the stored schedule; null removes it. */
  schedule?: ReportScheduleWire | null;
}

/** The schedule field of a stored view — present for an author only. */
export interface ReportScheduleViewField {
  schedule?: ReportScheduleView | null;
}

/** Monday 08:00 — what the switch opens on the first time it is turned on. */
export const DEFAULT_SCHEDULE: ScheduleDraft = {
  enabled: false,
  cadence: "weekly",
  weekday: 1,
  dayOfMonth: 1,
  time: "08:00",
  recipients: [],
};

export function draftFromWire(wire: ReportScheduleWire | null | undefined): ScheduleDraft | null {
  if (!wire) return null;
  return {
    enabled: wire.enabled,
    cadence: wire.cadence,
    weekday: wire.weekday ?? DEFAULT_SCHEDULE.weekday,
    dayOfMonth: wire.dayOfMonth ?? DEFAULT_SCHEDULE.dayOfMonth,
    time: wire.time,
    recipients: wire.recipients,
  };
}

/** What to send; no draft is no schedule, which removes a stored one. */
export function wireFromDraft(draft: ScheduleDraft | null): ReportScheduleWire | null {
  if (draft === null) return null;
  const { cadence } = draft;
  return {
    enabled: draft.enabled,
    cadence,
    ...(cadence === "weekly" || cadence === "biweekly" ? { weekday: draft.weekday } : {}),
    ...(cadence === "monthly" ? { dayOfMonth: draft.dayOfMonth } : {}),
    time: draft.time,
    recipients: draft.recipients,
  };
}
