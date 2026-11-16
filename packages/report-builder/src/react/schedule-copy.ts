import type { ScheduleCadence } from "../schedule";

/** What the summary sentence under the switch is told about the choice. */
export interface ReportScheduleSummaryInput {
  cadence: ScheduleCadence;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
  dayOfMonth: number;
  /** `HH:MM`. */
  time: string;
}

/**
 * The words of the "Envio automático" section of the settings dialog
 * (FUT-776). Its own module so the pack interface stays under the size gate.
 */
export interface ReportScheduleCopy {
  /** The section's heading: the switch's label. */
  label: string;
  /** The line under the switch, naming what is chosen ("… toda segunda, 8h"). */
  summary(input: ReportScheduleSummaryInput): string;
  frequencyLabel: string;
  /** The four parts of the frequency control. */
  cadences: Readonly<Record<ScheduleCadence, string>>;
  weekdayLabel: string;
  /** Sunday first, matching the stored numbering. */
  weekdays: readonly string[];
  dayOfMonthLabel: string;
  dayOfMonthOption(day: number): string;
  /** Said only when the chosen day does not exist in every month. */
  monthEndNote: string;
  timeLabel: string;
  recipientsLabel: string;
  recipientsLoading: string;
  recipientsFailed: string;
  recipientsEmpty: string;
  /** The footnote under the people list: whose clock, and who is left out. */
  zoneNote(timeZone: string): string;
}
