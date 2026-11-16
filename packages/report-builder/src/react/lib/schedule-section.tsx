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
import { useEffect, useRef, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@12-apps/ui/form/Checkbox";
import { Select } from "@12-apps/ui/form/Select";
import { Switch } from "@12-apps/ui/form/Switch";
import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { SCHEDULE_CADENCES, type ScheduleCadence } from "../../schedule";
import { CONTROL_RADIUS_PX } from "./report-surface";
import { DEFAULT_SCHEDULE, type ScheduleDraft } from "./schedule-draft";
import { Field } from "./settings-fields";
import { useReportCopy, useReportSurface } from "../transport-context";
import type { ScheduleRecipient } from "../schedule-surface";

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

function RecipientList({
  recipients,
  selected,
  onToggle,
  testId,
}: {
  recipients: ScheduleRecipient[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  testId: string;
}): JSX.Element {
  return (
    <Stack spacing={0.25} data-testid={`${testId}-recipients`}>
      {recipients.map((person) => (
        <Checkbox
          key={person.id}
          label={person.name}
          helperText={person.canReceive ? person.detail : (person.reason ?? person.detail)}
          disabled={!person.canReceive}
          checked={person.canReceive && selected.includes(person.id)}
          onChange={(_event, checked) => onToggle(person.id, checked)}
          data-testid={`${testId}-recipient-${person.id}`}
        />
      ))}
    </Stack>
  );
}

/** The people the host offers, with the loading and failure stories a list needs. */
function Recipients({
  value,
  onChange,
  tenantSlug,
  entities,
  testId,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  tenantSlug: string;
  entities: string[];
  testId: string;
}): JSX.Element {
  const copy = useReportCopy().screens.settings.schedule;
  const surface = useReportSurface().schedule;
  const query = useQuery({
    queryKey: ["report-schedule-recipients", tenantSlug, entities.join(",")],
    queryFn: () => surface?.recipients({ tenantSlug, entities }) ?? Promise.resolve([]),
    enabled: surface !== undefined,
  });
  const people = query.data;
  const settled = useRef(false);

  // Once per opening: the person who saved starts ticked, and anyone ticked
  // who the host now says cannot receive is dropped, so a save never carries
  // someone the report would be withheld from.
  useEffect(() => {
    if (!people || settled.current) return;
    settled.current = true;
    const allowed = new Set(people.filter((person) => person.canReceive).map((person) => person.id));
    const kept = value.recipients.filter((id) => allowed.has(id));
    const next =
      kept.length === 0 && value.recipients.length === 0
        ? people.filter((person) => person.canReceive && person.preselected).map((person) => person.id)
        : kept;
    if (next.length !== value.recipients.length || next.some((id, i) => id !== value.recipients[i])) {
      onChange({ ...value, recipients: next });
    }
  }, [people, value, onChange]);

  const toggle = (id: string, checked: boolean): void =>
    onChange({
      ...value,
      recipients: checked
        ? [...new Set([...value.recipients, id])]
        : value.recipients.filter((current) => current !== id),
    });

  let body: JSX.Element;
  if (query.isPending) {
    body = (
      <Text variant="body" size="sm" color="secondary" data-testid={`${testId}-recipients-loading`}>
        {copy.recipientsLoading}
      </Text>
    );
  } else if (query.isError || !people) {
    body = (
      <Text variant="body" size="sm" color="danger" data-testid={`${testId}-recipients-error`}>
        {copy.recipientsFailed}
      </Text>
    );
  } else if (people.length === 0) {
    body = (
      <Text variant="body" size="sm" color="secondary" data-testid={`${testId}-recipients-empty`}>
        {copy.recipientsEmpty}
      </Text>
    );
  } else {
    body = (
      <RecipientList recipients={people} selected={value.recipients} onToggle={toggle} testId={testId} />
    );
  }
  return <Field label={copy.recipientsLabel}>{body}</Field>;
}

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
        sx={{
          width: "100%",
          flexWrap: "nowrap",
          // Four equal parts that still fit the narrowest phone: the group's
          // own margin round each part goes, and the label steps down a size.
          "& .MuiToggleButton-root": {
            flex: "1 1 0",
            minWidth: 0,
            m: 0,
            px: 0.25,
            whiteSpace: "nowrap",
            typography: { xs: "caption", sm: "body2" },
          },
        }}
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
  const surface = useReportSurface();
  const needsRecipient = useReportCopy().screens.editor.needsRecipient;
  const schedule = surface.schedule;
  if (!schedule) return null;
  if (schedule.lockedReason !== undefined) {
    return <LockedRow reason={schedule.lockedReason} testId={`${testId}-schedule`} />;
  }
  const draft = value ?? DEFAULT_SCHEDULE;
  return (
    <Stack spacing={1.5} data-testid={`${testId}-schedule`}>
      <Switch
        label={copy.label}
        description={copy.summary({ ...draft })}
        checked={draft.enabled}
        onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
        data-testid={`${testId}-schedule-switch`}
      />
      {draft.enabled ? (
        <>
          <Frequency value={draft.cadence} onChange={(cadence) => onChange({ ...draft, cadence })} testId={testId} />
          <WhenFields value={draft} onChange={onChange} testId={testId} />
          <Recipients
            value={draft}
            onChange={onChange}
            tenantSlug={tenantSlug}
            entities={entities}
            testId={testId}
          />
          {draft.recipients.length === 0 ? (
            <Text variant="body" size="xs" color="danger" role="alert" data-testid={`${testId}-schedule-needs-recipient`}>
              {needsRecipient}
            </Text>
          ) : null}
          <Text variant="body" size="xs" color="secondary">
            {copy.zoneNote(surface.timeZone)}
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
