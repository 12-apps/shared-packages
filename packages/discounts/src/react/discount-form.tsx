"use client";

import { useState, type JSX } from "react";

import { minLength, required } from "@12-apps/forms-core";
import { Alert } from "@12-apps/ui/data-display/Alert";
import {
  Fields,
  FormContainer,
  FormErrorSnackbar,
  SubmitButton,
} from "@12-apps/ui/form/total-form";
import { Stack } from "@12-apps/ui/mui/Stack";

import type { DiscountSchedule } from "../engine/schedule";
import type { ComboRequirement } from "../engine/types";

import type { DiscountFormPayload, DiscountsApiClient, DiscountWireRecord, WireTargetGroup } from "./api";
import type { DiscountsWebCopy } from "./copy";
import {
  ComboCapField,
  DiscountSwitches,
  KindField,
  LimitFields,
  RewardFields,
  ScopeField,
  TriggerFields,
  WindowFields,
  type CurrencyFieldComponent,
} from "./discount-form-fields";
import { DiscountTargetPicker } from "./discount-target-picker";
import { blankWindow } from "./schedule-builder";
import { validate, type FormTargets } from "./discount-form-validate";
import { initialValues, type DiscountFormValues } from "./discount-form-values";
import { kindOptions, typeAndScopeFor } from "./form-kind";
import type { DiscountsFormatters } from "./format";

/**
 * The create/edit form — shared by the header's create dialog and the row
 * menu's edit dialog, so the fields and the submit live in one place.
 * `editing === null` creates; otherwise it re-states the rule whole.
 *
 * Two kinds of value are deliberately NOT `total-form` values, for one reason:
 * `total-form` holds STRINGS. The two switches (booleans) and the target id
 * lists (arrays) sit in local state beside the container and are merged in at
 * submit.
 *
 * Every rule checked here is ALSO checked on the server. This half exists for
 * the operator's sake — instant, field-attached feedback — never as the
 * authority: the surface re-validates, and a server refusal comes back through
 * `setFieldErrors` and paints the same inputs red.
 */

/** The values `total-form` cannot hold, kept beside it and merged at submit. */
function useNonStringState(editing: DiscountWireRecord | null) {
  const [active, setActive] = useState<boolean>(editing?.active ?? true);
  const [stackable, setStackable] = useState<boolean>(editing?.stackable ?? true);
  const [categoryIds, setCategoryIds] = useState<string[]>(editing?.categoryIds ?? []);
  const [menuItemIds, setMenuItemIds] = useState<string[]>(editing?.menuItemIds ?? []);
  // The combo's groups are the third array, and the one whose ORDER matters:
  // the list the operator built is the list a card reads back, and the server
  // stamps each group's index as its stored `position`.
  const [comboRequirements, setComboRequirements] = useState<ComboRequirement[]>(() =>
    editing?.comboRequirements ? [...editing.comboRequirements] : [],
  );
  // The weekly schedule (FUT-996) is the fourth: a nested structure edited with
  // chips and clocks, which `total-form`'s strings cannot hold.
  //
  // Its ON/OFF is kept SEPARATE from its contents on purpose. An operator who
  // switches back to "Sempre" and then changes their mind has not lost the days
  // they picked — the rows survive the toggle and only the SUBMIT reads the
  // switch. Collapsing the two would make the radio destructive.
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(
    () => (editing?.schedule?.windows.length ?? 0) > 0,
  );
  const [schedule, setSchedule] = useState<DiscountSchedule>(() =>
    editing?.schedule && editing.schedule.windows.length > 0
      ? { windows: editing.schedule.windows.map((w) => ({ ...w, days: [...w.days] })) }
      : { windows: [blankWindow()] },
  );
  return {
    active,
    stackable,
    categoryIds,
    menuItemIds,
    comboRequirements,
    scheduleEnabled,
    schedule,
    setActive,
    setStackable,
    setCategoryIds,
    setMenuItemIds,
    setComboRequirements,
    setScheduleEnabled,
    setSchedule,
  };
}

type NonStringState = ReturnType<typeof useNonStringState>;
type SubmitHelpers = { setFieldErrors: (errors: Record<string, string | undefined>) => void };

export interface DiscountFormProps {
  api: DiscountsApiClient;
  copy: DiscountsWebCopy;
  formatters: DiscountsFormatters;
  currencyField: CurrencyFieldComponent;
  groups: readonly WireTargetGroup[];
  editing: DiscountWireRecord | null;
  onSaved: () => void;
  /** Where a refused or failed write is reported, beyond the operator's screen. */
  onError: (error: unknown, context: string) => void;
  /** The store's timezone as a person says it — shown under the clocks. */
  timezoneLabel?: string;
}

/**
 * Build the submit handler.
 *
 * A factory rather than a closure inside the component, so the component stays
 * inside the size gate and the validate → send → attribute-the-failure sequence
 * reads as one block.
 */
function makeSubmit(
  props: DiscountFormProps,
  extra: NonStringState,
  setError: (message: string | null) => void,
): (values: DiscountFormValues, helpers: SubmitHelpers) => Promise<void> {
  const { api, copy, formatters, editing, onSaved, onError } = props;
  return async function handleSubmit(values, { setFieldErrors }): Promise<void> {
    setError(null);
    const targets: FormTargets = {
      categoryIds: extra.categoryIds,
      menuItemIds: extra.menuItemIds,
      comboRequirements: extra.comboRequirements,
    };
    const invalid = validate(values, targets, formatters, copy, {
      enabled: extra.scheduleEnabled,
      schedule: extra.schedule,
    });
    if (Object.keys(invalid).length > 0) {
      setFieldErrors(invalid);
      setError(copy.form.reviewFields);
      return;
    }
    const payload: DiscountFormPayload = {
      ...values,
      // The switch decides whether the rows are sent at all — see the state
      // hook for why the two are separate.
      schedule: extra.scheduleEnabled ? extra.schedule : null,
      // The one place the form's question becomes the API's two columns. Every
      // other consumer — the write path, the evaluator, the CHECK constraints —
      // still sees the `type`/`scope` pair it always did.
      ...typeAndScopeFor(values),
      ...targets,
      stackable: extra.stackable,
      active: extra.active,
    };
    const result = editing
      ? await api.update(editing.id, payload)
      : await api.create(payload);
    if (result.ok) {
      onSaved();
      return;
    }
    setError(result.error);
    // The server attributes what it can — a duplicate code, a rate out of range
    // — so highlight those inputs instead of only showing the banner.
    if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    onError(result, editing ? "discounts.update" : "discounts.create");
  };
}

export function DiscountForm(props: DiscountFormProps): JSX.Element {
  const { copy, formatters, currencyField, groups, editing } = props;
  const [error, setError] = useState<string | null>(null);
  const extra = useNonStringState(editing);
  const handleSubmit = makeSubmit(props, extra, setError);

  return (
    <FormContainer<DiscountFormValues>
      initialValues={initialValues(editing, formatters)}
      schema={{ name: [required(copy.form.nameRequired), minLength(2)] }}
      onSubmit={handleSubmit}
      dataTestId="discount-form"
    >
      <Stack spacing={2}>
        <Fields.TextField name="name" label={copy.form.name} />
        <KindField copy={copy} kinds={kindOptions(editing)} />
        <RewardFields copy={copy} currencyField={currencyField} />
        <ScopeField copy={copy} />
        <DiscountTargetPicker
          groups={groups}
          copy={copy}
          selection={{
            categoryIds: extra.categoryIds,
            menuItemIds: extra.menuItemIds,
            comboRequirements: extra.comboRequirements,
            onCategoryIdsChange: extra.setCategoryIds,
            onMenuItemIdsChange: extra.setMenuItemIds,
            onComboRequirementsChange: extra.setComboRequirements,
          }}
        />
        <ComboCapField copy={copy} />
        <TriggerFields copy={copy} />
        <WindowFields
          copy={copy}
          schedule={extra.schedule}
          scheduleEnabled={extra.scheduleEnabled}
          timezoneLabel={props.timezoneLabel ?? null}
          onScheduleChange={extra.setSchedule}
          onScheduleEnabledChange={extra.setScheduleEnabled}
        />
        <LimitFields copy={copy} currencyField={currencyField} />
        <DiscountSwitches
          copy={copy}
          active={extra.active}
          stackable={extra.stackable}
          onActive={extra.setActive}
          onStackable={extra.setStackable}
        />
        {error && (
          <Alert
            variant="danger"
            title={copy.form.saveFailed}
            description={error}
            data-testid="discount-form-error"
          />
        )}
        <SubmitButton dataTestId="discount-form-submit">
          {editing ? copy.form.submitEdit : copy.form.submitCreate}
        </SubmitButton>
      </Stack>
      <FormErrorSnackbar />
    </FormContainer>
  );
}
