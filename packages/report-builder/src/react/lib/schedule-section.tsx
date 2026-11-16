/**
 * The "Envio automático" section of "Ajustes do relatório" (FUT-776): the
 * switch, the four-part frequency, the day and time, and who receives it.
 *
 * It lives beside the dialog rather than in it because the dialog sits on the
 * size gate's ceiling, and this is a control with rules of its own.
 *
 * The package decides nothing about WHO may receive a report: the host's list
 * says, per person, whether they can and why not, and this renders that
 * answer — a person who cannot is shown disabled with the reason beside them,
 * never hidden, so the author sees why somebody they expected is missing.
 */
import { useRef, type JSX } from "react";

import { Select } from "@12-apps/ui/form/Select";
import { Switch } from "@12-apps/ui/form/Switch";
import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { fieldBorder } from "@12-apps/ui/tokens";
import { Text } from "@12-apps/ui/typography/Text";

import { SCHEDULE_CADENCES, type ScheduleCadence } from "../../schedule";
import { CONTROL_HEIGHT, CONTROL_RADIUS_PX } from "./report-surface";
import { DEFAULT_SCHEDULE, type ScheduleDraft } from "./schedule-draft";
import { Recipients } from "./schedule-recipients";
import { Field } from "./settings-fields";
import { zoneDisplayName } from "./schedule-zone";
import { useReportCopy, useReportSurface } from "../transport-context";

/** Half-hour steps, which is as fine as a person asks for a report to arrive. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const value = `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`;
  return { value, label: value };
});

const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1);

/**
 * A control the host has locked (a plan that does not include it). Focusable
 * and `aria-disabled`, not `disabled`: the sentence saying WHY is the one
 * thing a keyboard user must be able to reach.
 */
function LockedRow({ reason, testId }: { reason: string; testId: string }): JSX.Element {
  const copy = useReportCopy().screens.settings.schedule;
  return (
    <Field label={copy.label}>
      <Box
        role="group"
        aria-disabled="true"
        aria-describedby={`${testId}-reason`}
        tabIndex={0}
        data-testid={testId}
        sx={{
          p: 1.25,
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: `${CONTROL_RADIUS_PX}px`,
          color: "text.disabled",
        }}
      >
        <Text variant="body" size="sm" color="secondary" id={`${testId}-reason`}>
          {reason}
        </Text>
      </Box>
    </Field>
  );
}

/**
 * The package's own segmented frame (`range-toggle`: the field border and the
 * control radius), so the chosen part has a neighbour to sit inside of and a
 * focused part reads differently from the chosen one. One label size, because
 * `caption` fits the four words at 320 and a viewport breakpoint would be the
 * wrong thing to measure in a dialog of fixed width.
 */
const FREQUENCY_SX = {
  width: "100%",
  height: CONTROL_HEIGHT,
  boxSizing: "border-box",
  flexWrap: "nowrap",
  p: 0.25,
  border: fieldBorder,
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  bgcolor: "background.paper",
  "& .MuiToggleButtonGroup-grouped": {
    flex: "1 1 0",
    minWidth: 0,
    m: 0,
    px: 0.25,
    height: "100%",
    minHeight: 0,
    whiteSpace: "nowrap",
    typography: "caption",
    borderRadius: `${CONTROL_RADIUS_PX}px !important`,
  },
  "& .MuiToggleButtonGroup-grouped.Mui-focusVisible": {
    outline: "2px solid",
    outlineColor: "primary.main",
    outlineOffset: -2,
  },
} as const;

/** The frequency: four equal parts on ONE line at every width (ADR 0190). */
function Frequency({
  value,
  onChange,
  testId,
}: {
  value: ScheduleCadence;
  onChange: (next: ScheduleCadence) => void;
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.settings.schedule;
  return (
    <Field label={copy.frequencyLabel}>
      <ToggleGroup
        variant="exclusive"
        selection="quiet"
        size="sm"
        options={SCHEDULE_CADENCES.map((cadence) => ({ value: cadence, label: copy.cadences[cadence] }))}
        value={value}
        onChange={(_event, next) => {
          // An exclusive group reports null when the chosen part is pressed again.
          if (typeof next === "string") onChange(next as ScheduleCadence);
        }}
        aria-label={copy.frequencyLabel}
        dataTestId={`${testId}-frequency`}
        sx={FREQUENCY_SX}
      />
    </Field>
  );
}

/** The day (of the week or of the month, by cadence) beside the time. */
function WhenFields({
  value,
  onChange,
  testId,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.settings.schedule;
  const { cadence } = value;
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5 }}>
        {cadence === "daily" ? null : (
          <Box sx={{ flex: "3 1 9rem", minWidth: 0 }}>
            {cadence === "monthly" ? (
              <Select
                size="sm"
                label={copy.dayOfMonthLabel}
                options={DAY_OF_MONTH_OPTIONS.map((day) => ({ value: String(day), label: copy.dayOfMonthOption(day) }))}
                value={String(value.dayOfMonth)}
                onChange={(event) => onChange({ ...value, dayOfMonth: Number(event.target.value) })}
                data-testid={`${testId}-day-of-month`}
              />
            ) : (
              <Select
                size="sm"
                label={copy.weekdayLabel}
                options={copy.weekdays.map((label, day) => ({ value: String(day), label }))}
                value={String(value.weekday)}
                onChange={(event) => onChange({ ...value, weekday: Number(event.target.value) })}
                data-testid={`${testId}-weekday`}
              />
            )}
          </Box>
        )}
        <Box sx={{ flex: "2 1 6rem", minWidth: 0 }}>
          <Select
            size="sm"
            label={copy.timeLabel}
            options={TIME_OPTIONS}
            value={value.time}
            onChange={(event) => onChange({ ...value, time: String(event.target.value) })}
            data-testid={`${testId}-time`}
          />
        </Box>
      </Stack>
      {cadence === "monthly" && value.dayOfMonth > 28 ? (
        <Text variant="body" size="xs" color="secondary" data-testid={`${testId}-month-end`}>
          {copy.monthEndNote}
        </Text>
      ) : null}
    </Stack>
  );
}

/** The switch row: a semibold title, the line saying what is chosen (only while on), the switch. */
function SwitchRow({
  draft,
  onChange,
  testId,
}: {
  draft: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.settings.schedule;
  const inputId = `${testId}-schedule-switch-input`;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 2 }}>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Box component="label" htmlFor={inputId} sx={{ cursor: "pointer" }}>
          <Text variant="body" size="md" weight="semibold" as="span">
            {copy.label}
          </Text>
        </Box>
        {draft.enabled ? (
          <Text variant="body" size="xs" color="secondary" id={`${testId}-schedule-summary`}>
            {copy.summary({ ...draft })}
          </Text>
        ) : null}
      </Stack>
      <Switch
        id={inputId}
        checked={draft.enabled}
        onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
        inputProps={{ "aria-label": copy.label }}
        data-testid={`${testId}-schedule-switch`}
      />
    </Stack>
  );
}

export function ScheduleSection({
  value,
  onChange,
  tenantSlug,
  entities,
  testId,
}: {
  value: ScheduleDraft | null;
  onChange: (next: ScheduleDraft | null) => void;
  tenantSlug: string;
  /** The entities the report reads — what the host checks each person against. */
  entities: string[];
  testId: string;
}): JSX.Element | null {
  const copy = useReportCopy().screens.settings.schedule;
  const locale = useReportCopy().engine.spec.locale;
  const surface = useReportSurface();
  const preselect = useRef(false);
  const schedule = surface.schedule;
  if (!schedule) return null;
  if (schedule.lockedReason !== undefined) {
    return <LockedRow reason={schedule.lockedReason} testId={`${testId}-schedule`} />;
  }
  const draft = value ?? DEFAULT_SCHEDULE;
  const turn = (next: ScheduleDraft): void => {
    if (next.enabled && !draft.enabled && next.recipients.length === 0) preselect.current = true;
    onChange(next);
  };
  return (
    <Stack spacing={1.5} data-testid={`${testId}-schedule`}>
      <SwitchRow draft={draft} onChange={turn} testId={testId} />
      {draft.enabled ? (
        <>
          <Frequency value={draft.cadence} onChange={(cadence) => onChange({ ...draft, cadence })} testId={testId} />
          <WhenFields value={draft} onChange={onChange} testId={testId} />
          <Recipients
            value={draft}
            onChange={onChange}
            tenantSlug={tenantSlug}
            entities={entities}
            preselect={preselect}
            testId={testId}
          />
          <Text variant="body" size="xs" color="secondary">
            {copy.zoneNote(zoneDisplayName(surface.timeZone, locale, schedule.timeZoneLabel))}
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
