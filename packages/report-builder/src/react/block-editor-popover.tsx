/**
 * The block's ✎ popup (FUT-391): the small panel where a block's QUERY is
 * chosen — which collection it reads, how it groups and measures, and how it
 * renders. It deliberately does not own the block's title or width: those are
 * inline on the canvas, where their effect is visible.
 *
 * Every keystroke here re-emits the block's spec, so the canvas behind the
 * popup re-runs and re-renders live — the popup and the block are the same
 * edit, not a form that gets applied afterwards.
 */
import { useState, type JSX } from "react";

import { Popover } from "@12-apps/ui/data-display/Popover";
import { Select } from "@12-apps/ui/form/Select";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { spanOptionsFor } from "../layout";

import {
  draftFromSpec,
  specFromDraft,
  switchEntityDraft,
  withValidChart,
  type BuilderDraft,
} from "./builder-model";
import {
  DimensionsSection,
  FiltersSection,
  MeasuresSection,
  PresentationSection,
} from "./builder-sections";
import type { ReportEntityFields, ReportField, ReportSpecWire } from "./custom-reports-api";

function fieldMapOf(entity: ReportEntityFields | undefined): Map<string, ReportField> {
  return new Map((entity?.fields ?? []).map((field) => [field.field, field]));
}

/** Width labels: twelfths of the canvas, with the familiar fractions called out. */
const SPAN_LABELS: Record<number, string> = {
  2: "1/6",
  3: "1/4",
  4: "1/3",
  6: "1/2",
  8: "2/3",
  9: "3/4",
  12: "Inteira",
};

function spanLabel(span: number): string {
  const fraction = SPAN_LABELS[span];
  return fraction ? `${span}/12 · ${fraction}` : `${span}/12`;
}

/**
 * Collection + shape + visualization + width — the block's whole definition in
 * one panel. Width lives here rather than on the block's own toolbar because a
 * 2-column block has no room for a picker: its chrome would crowd out the
 * rendering the author is trying to judge.
 */
function BlockQueryFields({
  draft,
  entities,
  span,
  apply,
  onSpanChange,
  testId,
}: {
  draft: BuilderDraft;
  entities: ReportEntityFields[];
  span: number;
  apply: (next: BuilderDraft) => void;
  onSpanChange: (span: number) => void;
  testId: string;
}): JSX.Element {
  const fields = entities.find((candidate) => candidate.entity === draft.entity)?.fields ?? [];
  const update = (patch: Partial<BuilderDraft>): void => apply({ ...draft, ...patch });
  return (
    <Stack spacing={2}>
      <Text variant="heading" size="xs" as="h3">
        Bloco
      </Text>
      <Select
        size="small"
        label="Coleção"
        options={entities.map((candidate) => ({
          value: candidate.entity,
          label: candidate.label,
        }))}
        value={draft.entity}
        onChange={(event) =>
          apply(switchEntityDraft(draft, entities, event.target.value as string))
        }
        data-testid={`${testId}-entity`}
      />
      <DimensionsSection draft={draft} fields={fields} update={update} />
      <MeasuresSection draft={draft} fields={fields} update={update} />
      <FiltersSection draft={draft} fields={fields} update={update} />
      <PresentationSection draft={draft} fields={fields} update={update} />
      <Select
        size="small"
        label="Largura"
        options={spanOptionsFor(specFromDraft(draft, fieldMapOf(
          entities.find((candidate) => candidate.entity === draft.entity),
        )).presentation).map((option) => ({
          value: String(option),
          label: spanLabel(option),
        }))}
        value={String(span)}
        onChange={(event) => onSpanChange(Number(event.target.value))}
        data-testid={`${testId}-span`}
      />
    </Stack>
  );
}

export function BlockEditorPopover({
  open,
  anchorEl,
  onClose,
  entities,
  spec,
  span,
  onChange,
  onSpanChange,
  testId,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  entities: ReportEntityFields[];
  spec: ReportSpecWire;
  span: number;
  onChange: (spec: ReportSpecWire) => void;
  onSpanChange: (span: number) => void;
  testId: string;
}): JSX.Element {
  // Seeded once per opening (the caller remounts via `key`): the draft keeps
  // half-finished rows — a blank "+ Medida" line, a filter with no value yet —
  // that the serialized spec necessarily drops.
  const [draft, setDraft] = useState<BuilderDraft>(() => draftFromSpec("", "", spec));

  const apply = (next: BuilderDraft): void => {
    const map = fieldMapOf(entities.find((candidate) => candidate.entity === next.entity));
    const valid = withValidChart(next, map);
    setDraft(valid);
    onChange(specFromDraft(valid, map));
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      maxWidth={380}
      dataTestId={testId}
    >
      <Box sx={{ p: 2, width: 360, maxHeight: "70vh", overflowY: "auto" }}>
        <BlockQueryFields
          draft={draft}
          entities={entities}
          span={span}
          apply={apply}
          onSpanChange={onSpanChange}
          testId={testId}
        />
      </Box>
    </Popover>
  );
}
