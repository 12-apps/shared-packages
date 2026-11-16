import type { ReportScheduleCopy } from "./schedule-copy";

/** The en-US words of the delivery section of the report settings dialog (FUT-776). */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function clock(time: string): string {
  const [hh = "0", mm = "00"] = time.split(":");
  const hours = Number(hh);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${mm} ${suffix}`;
}

function ordinal(day: number): string {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : day % 10] ?? "th"}`;
}

export const EN_US_REPORT_SCHEDULE_COPY: ReportScheduleCopy = {
  label: "Automatic delivery",
  summary: ({ cadence, weekday, dayOfMonth, time }) => {
    const at = clock(time);
    const day = WEEKDAYS[weekday] ?? "";
    if (cadence === "daily") return `E-mail it every day at ${at}`;
    if (cadence === "monthly") return `E-mail it on the ${ordinal(dayOfMonth)} of each month at ${at}`;
    return cadence === "weekly"
      ? `E-mail it every ${day} at ${at}`
      : `E-mail it every other ${day} at ${at}`;
  },
  frequencyLabel: "Frequency",
  cadences: { daily: "Daily", weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" },
  weekdayLabel: "Day of the week",
  weekdays: WEEKDAYS,
  dayOfMonthLabel: "Day of the month",
  dayOfMonthOption: (day) => `Day ${day}`,
  monthEndNote: "In shorter months it goes out on the last day.",
  timeLabel: "Time",
  recipientsLabel: "Who receives it",
  recipientsLoading: "Loading the store's people…",
  recipientsFailed: "Could not load the store's people.",
  recipientsEmpty: "No one in the store to choose.",
  needsRecipient: "Choose who receives the automatic delivery, or turn it off.",
  retry: "Try again",
  zoneNote: (zoneName) =>
    `Time in ${zoneName} (the store's zone). Only people with access to this report's data receive it.`,
};
