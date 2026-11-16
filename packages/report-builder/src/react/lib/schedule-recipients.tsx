/**
 * "Quem recebe" (FUT-776): the people the host offers, each as a two-line row,
 * the ones the host refuses shown disabled with the reason. Split from the
 * section only to stay under the size gate.
 */
import { useEffect, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@12-apps/ui/form/Button";
import { Checkbox } from "@12-apps/ui/form/Checkbox";
import { Box } from "@12-apps/ui/mui/Box";
import { FormControlLabel } from "@12-apps/ui/mui/FormControlLabel";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ScheduleRecipient } from "../schedule-surface";
import { useReportCopy, useReportSurface } from "../transport-context";
import type { ScheduleDraft } from "./schedule-draft";
import { Field } from "./settings-fields";

/**
 * One person: the name and, right under it, what they are (or why they cannot
 * receive this report), as one two-line label with a hairline between rows.
 */
function RecipientRow({
  person,
  checked,
  onToggle,
  testId,
}: {
  person: ScheduleRecipient;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  testId: string;
}): JSX.Element {
  const line = person.canReceive ? person.detail : (person.reason ?? person.detail);
  const lineId = `${testId}-recipient-${person.id}-detail`;
  return (
    <Box sx={{ borderBottom: "1px solid", borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
      <FormControlLabel
        disabled={!person.canReceive}
        sx={{ m: 0, py: 0.25, width: "100%", alignItems: "center", gap: 0.5 }}
        control={
          <Checkbox
            checked={checked}
            onChange={(_event, next) => onToggle(next)}
            inputProps={line ? { "aria-describedby": lineId } : undefined}
            data-testid={`${testId}-recipient-${person.id}`}
          />
        }
        label={
          <Stack>
            <Text variant="body" size="sm" color={person.canReceive ? "primary" : "secondary"}>
              {person.name}
            </Text>
            {line ? (
              <Text variant="body" size="xs" color="secondary" id={lineId} data-testid={`${testId}-recipient-${person.id}-helper`}>
                {line}
              </Text>
            ) : null}
          </Stack>
        }
      />
    </Box>
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
    <Stack data-testid={`${testId}-recipients`}>
      {recipients.map((person) => (
        <RecipientRow
          key={person.id}
          person={person}
          checked={person.canReceive && selected.includes(person.id)}
          onToggle={(checked) => onToggle(person.id, checked)}
          testId={testId}
        />
      ))}
    </Stack>
  );
}

/** The people the host offers, with the loading and failure stories a list needs. */
export function Recipients({
  value,
  onChange,
  tenantSlug,
  entities,
  preselect,
  testId,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  tenantSlug: string;
  entities: string[];
  /** Set when the switch was just turned on: tick the person who saved once the list is here. */
  preselect: { current: boolean };
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
  const allowed = new Set((people ?? []).filter((person) => person.canReceive).map((person) => person.id));

  // Only in answer to the person turning the switch on, never on opening a
  // saved schedule: opening must not make the form dirty.
  useEffect(() => {
    if (!people || !preselect.current) return;
    preselect.current = false;
    const first = people.filter((person) => person.canReceive && person.preselected).map((person) => person.id);
    if (first.length > 0) onChange({ ...value, recipients: first });
  }, [people, preselect, value, onChange]);

  // A person the host now refuses is shown unticked; the next edit of the list
  // drops them from the draft, and the host re-checks at send time regardless.
  const toggle = (id: string, checked: boolean): void => {
    const next = checked ? [...value.recipients, id] : value.recipients.filter((current) => current !== id);
    onChange({ ...value, recipients: [...new Set(next)].filter((current) => allowed.has(current)) });
  };

  let body: JSX.Element;
  if (query.isPending) {
    body = (
      <Text variant="body" size="sm" color="secondary" data-testid={`${testId}-recipients-loading`}>
        {copy.recipientsLoading}
      </Text>
    );
  } else if (query.isError || !people) {
    body = (
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Text variant="body" size="sm" color="danger" data-testid={`${testId}-recipients-error`}>
          {copy.recipientsFailed}
        </Text>
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()} dataTestId={`${testId}-recipients-retry`}>
          {copy.retry}
        </Button>
      </Stack>
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
  const nobody = query.isSuccess && !value.recipients.some((id) => allowed.has(id)) && (people?.length ?? 0) > 0;
  return (
    <Field label={copy.recipientsLabel}>
      <Stack spacing={0.75}>
        {body}
        {nobody ? <NeedsRecipient testId={testId} /> : null}
      </Stack>
    </Field>
  );
}

/** Said once the list has loaded and nobody is ticked, so it never flashes while loading. */
function NeedsRecipient({ testId }: { testId: string }): JSX.Element {
  const text = useReportCopy().screens.editor.needsRecipient;
  return (
    <Text variant="body" size="xs" color="danger" role="alert" data-testid={`${testId}-schedule-needs-recipient`}>
      {text}
    </Text>
  );
}
