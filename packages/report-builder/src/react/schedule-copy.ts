import type { ScheduleCadence } from "../schedule";
import type { ReportScreensCopy } from "./screens-copy";

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
  /** `zoneName` is the whole phrase for the clock, such as "Horário de Brasília". */
  zoneNote(zoneName: string): string;
  /** Why a save is held with the switch on and nobody ticked. */
  needsRecipient: string;
  /** The recipients list could not be loaded: the retry control. */
  retry: string;
}

/**
 * What the screens read: `ReportBuilderCopy` with the delivery words filled in,
 * so a host whose pack predates them keeps compiling and renders the package's
 * own words (FUT-776). `withScheduleDefaults` produces it.
 */
export type ResolvedScreensCopy = Omit<ReportScreensCopy, "settings" | "editor"> & {
  settings: ReportScreensCopy["settings"] & { schedule: ReportScheduleCopy };
  editor: ReportScreensCopy["editor"] & { needsRecipient: string };
};
