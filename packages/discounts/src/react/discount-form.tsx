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
  return {
    active,
    stackable,
    categoryIds,
    menuItemIds,
    comboRequirements,
    setActive,
    setStackable,
    setCategoryIds,
    setMenuItemIds,
    setComboRequirements,
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
    const invalid = validate(values, targets, formatters, copy);
    if (Object.keys(invalid).length > 0) {
      setFieldErrors(invalid);
      setError(copy.form.reviewFields);
      return;
    }
    const payload: DiscountFormPayload = {
      ...values,
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
        <WindowFields copy={copy} />
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
