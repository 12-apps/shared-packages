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

import type { DiscountFormPayload, DiscountsApiClient, DiscountWireRecord, WireTargetGroup } from "./api";
import type { DiscountsWebCopy } from "./copy";
import {
  DiscountSwitches,
  LimitFields,
  RuleFields,
  ScopeField,
  WindowFields,
  type CurrencyFieldComponent,
} from "./discount-form-fields";
import { DiscountTargetPicker } from "./discount-target-picker";
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

interface DiscountFormValues extends Record<string, string> {
  name: string;
  type: string;
  percentOff: string;
  amountOff: string;
  scope: string;
  trigger: string;
  code: string;
  startsAt: string;
  endsAt: string;
  minSubtotal: string;
  usageLimit: string;
  perBuyerLimit: string;
}

/** `YYYY-MM-DD` for a native date input, from the wire's ISO instant. */
function toDateInput(iso: string | null): string {
  return iso === null ? "" : iso.slice(0, 10);
}

/** A new rule's defaults: the most common promotion an operator creates. */
const BLANK: DiscountFormValues = {
  name: "",
  type: "PERCENTAGE",
  percentOff: "",
  amountOff: "",
  scope: "ORDER",
  trigger: "AUTOMATIC",
  code: "",
  startsAt: "",
  endsAt: "",
  minSubtotal: "",
  usageLimit: "",
  perBuyerLimit: "",
};

function initialValues(
  editing: DiscountWireRecord | null,
  formatters: DiscountsFormatters,
): DiscountFormValues {
  if (editing === null) return { ...BLANK };
  const cents = (value: number | null): string =>
    value === null ? "" : formatters.toInput(Number((value / 100).toFixed(2)));
  return {
    name: editing.name,
    type: editing.type,
    percentOff: editing.percentOffBp === null ? "" : formatters.toInput(editing.percentOffBp / 100),
    amountOff: cents(editing.amountOffCents),
    scope: editing.scope,
    trigger: editing.trigger,
    code: editing.code ?? "",
    startsAt: toDateInput(editing.startsAt),
    endsAt: toDateInput(editing.endsAt),
    minSubtotal: cents(editing.minSubtotalCents),
    usageLimit: editing.usageLimit === null ? "" : String(editing.usageLimit),
    perBuyerLimit: editing.perBuyerLimit === null ? "" : String(editing.perBuyerLimit),
  };
}

/** The value half: a rate in (0, 100], or an amount above zero. */
function checkValue(
  values: DiscountFormValues,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  if (values.type === "PERCENTAGE") {
    const percent = formatters.parseDecimal(values.percentOff);
    if (percent === null || percent <= 0 || percent > 100) {
      return { percentOff: copy.form.invalidPercent };
    }
    return {};
  }
  const amount = formatters.parseDecimal(values.amountOff);
  return amount === null || amount <= 0 ? { amountOff: copy.form.invalidAmount } : {};
}

/** The cross-field rules a per-input schema cannot express. */
function validate(
  values: DiscountFormValues,
  targets: { categoryIds: string[]; menuItemIds: string[] },
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  const errors: Record<string, string> = { ...checkValue(values, formatters, copy) };
  if (values.trigger === "CODE" && values.code.trim() === "") {
    errors.code = copy.form.codeRequired;
  }
  if (values.scope === "CATEGORY" && targets.categoryIds.length === 0) {
    errors.scope = copy.form.categoryTargetRequired;
  }
  if (values.scope === "ITEM" && targets.menuItemIds.length === 0) {
    errors.scope = copy.form.itemTargetRequired;
  }
  // The window is half-open [start, end): equal dates are an EMPTY window, so
  // the rule is "after", not "not before".
  if (values.startsAt !== "" && values.endsAt !== "" && values.endsAt <= values.startsAt) {
    errors.endsAt = copy.form.endsBeforeStarts;
  }
  return errors;
}

/** The values `total-form` cannot hold, kept beside it and merged at submit. */
function useNonStringState(editing: DiscountWireRecord | null) {
  const [active, setActive] = useState<boolean>(editing?.active ?? true);
  const [stackable, setStackable] = useState<boolean>(editing?.stackable ?? true);
  const [categoryIds, setCategoryIds] = useState<string[]>(editing?.categoryIds ?? []);
  const [menuItemIds, setMenuItemIds] = useState<string[]>(editing?.menuItemIds ?? []);
  return {
    active,
    stackable,
    categoryIds,
    menuItemIds,
    setActive,
    setStackable,
    setCategoryIds,
    setMenuItemIds,
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
    const targets = { categoryIds: extra.categoryIds, menuItemIds: extra.menuItemIds };
    const invalid = validate(values, targets, formatters, copy);
    if (Object.keys(invalid).length > 0) {
      setFieldErrors(invalid);
      setError(copy.form.reviewFields);
      return;
    }
    const payload: DiscountFormPayload = {
      ...values,
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
        <RuleFields copy={copy} currencyField={currencyField} />
        <ScopeField copy={copy} />
        <DiscountTargetPicker
          groups={groups}
          copy={copy}
          selection={{
            categoryIds: extra.categoryIds,
            menuItemIds: extra.menuItemIds,
            onCategoryIdsChange: extra.setCategoryIds,
            onMenuItemIdsChange: extra.setMenuItemIds,
          }}
        />
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
