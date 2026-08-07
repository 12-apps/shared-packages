/**
 * A block's whole definition as form fields: collection, shape, visualization
 * and width. Extracted from the container that holds it (FUT-391) so the panel
 * and any future surface render the SAME controls — the container decides
 * where the form sits, never what it contains.
 *
 * Every keystroke re-emits the block's spec, so the canvas behind re-runs and
 * re-renders live: the form and the block are the same edit, not a form that
 * gets applied afterwards.
 */
import type { JSX } from "react";

import { Select } from "@12-apps/ui/form/Select";
import { Stack } from "@12-apps/ui/mui/Stack";



import { BlockWidthPicker } from "./block-width-picker";
import { specFromDraft, switchEntityDraft, type BuilderDraft } from "./builder-model";
import {
  FiltersSection,
  GroupBySection,
  MeasuresSection,
  PresentationSection,
  SplitBySection,
} from "./builder-sections";
import type { ReportEntityFields, ReportField } from "./custom-reports-api";

export function fieldMapOf(entity: ReportEntityFields | undefined): Map<string, ReportField> {
  return new Map((entity?.fields ?? []).map((field) => [field.field, field]));
}

export function BlockQueryFields({
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
  const entity = entities.find((candidate) => candidate.entity === draft.entity);
  const fields = entity?.fields ?? [];
  const update = (patch: Partial<BuilderDraft>): void => apply({ ...draft, ...patch });
  return (
    <Stack spacing={2}>
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
      <GroupBySection draft={draft} fields={fields} update={update} />
      <SplitBySection draft={draft} fields={fields} update={update} />
      <MeasuresSection draft={draft} fields={fields} update={update} />
      <FiltersSection draft={draft} fields={fields} update={update} />
      <PresentationSection draft={draft} fields={fields} update={update} />
      <BlockWidthPicker
        span={span}
        presentation={specFromDraft(draft, fieldMapOf(entity)).presentation}
        onChange={onSpanChange}
        testId={`${testId}-span`}
      />
    </Stack>
  );
}
