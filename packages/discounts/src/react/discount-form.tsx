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
import { fill, type DiscountsWebCopy } from "./copy";
import {
  DiscountSwitches,
  LimitFields,
  RuleFields,
  ScopeField,
  WindowFields,
  type CurrencyFieldComponent,
} from "./discount-form-fields";
import { comboUnits } from "./combo-slot-builder";
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
  bundlePrice: string;
  freeUnits: string;
  maxComboApplications: string;
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
  bundlePrice: "",
  freeUnits: "",
  maxComboApplications: "",
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
    bundlePrice: cents(editing.bundlePriceCents ?? null),
    freeUnits: editing.freeUnits == null ? "" : String(editing.freeUnits),
    maxComboApplications:
      editing.maxComboApplications == null ? "" : String(editing.maxComboApplications),
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

/** A whole number above zero, as typed. `null` when it is neither. */
function positiveCount(typed: string): number | null {
  const trimmed = typed.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** A money field that has to hold something above zero. */
function checkMoney(
  typed: string,
  field: string,
  message: string,
  formatters: DiscountsFormatters,
): Record<string, string> {
  const amount = formatters.parseDecimal(typed);
  return amount === null || amount <= 0 ? { [field]: message } : {};
}

/**
 * The free count, which is the one reward bounded by another field.
 *
 * "Take 3, three free" is a giveaway rather than a promotion, so it is compared
 * against what ONE application of the combo takes out of the cart. The ceiling
 * is named in the message: an operator told only "too many" has to guess the
 * number.
 */
function checkFreeUnits(
  typed: string,
  slots: readonly ComboRequirement[],
  copy: DiscountsWebCopy,
): Record<string, string> {
  const free = positiveCount(typed);
  if (free === null) return { freeUnits: copy.form.invalidFreeUnits };
  const units = comboUnits(slots);
  if (free >= units) {
    return {
      freeUnits: fill(copy.form.freeUnitsExceedCombo, { units, max: Math.max(units - 1, 0) }),
    };
  }
  return {};
}

/** The rate, in the 0–100 an operator thinks in rather than basis points. */
function checkPercent(
  typed: string,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  const percent = formatters.parseDecimal(typed);
  return percent === null || percent <= 0 || percent > 100
    ? { percentOff: copy.form.invalidPercent }
    : {};
}

/** The reward, checked against the input the chosen type actually mounted. */
function checkValue(
  values: DiscountFormValues,
  slots: readonly ComboRequirement[],
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  if (values.type === "FIXED_AMOUNT") {
    return checkMoney(values.amountOff, "amountOff", copy.form.invalidAmount, formatters);
  }
  if (values.type === "BUNDLE_PRICE") {
    return checkMoney(values.bundlePrice, "bundlePrice", copy.form.invalidBundlePrice, formatters);
  }
  if (values.type === "FREE_UNITS") return checkFreeUnits(values.freeUnits, slots, copy);
  return checkPercent(values.percentOff, formatters, copy);
}

/**
 * The combo half: the groups themselves, and the per-cart cap.
 *
 * Every rule here is also the server's (`validate-combo.ts`), and deliberately
 * so — this half exists to attach the refusal to the input the operator is
 * looking at, never to be the authority.
 */
function checkCombo(
  values: DiscountFormValues,
  slots: readonly ComboRequirement[],
  copy: DiscountsWebCopy,
): Record<string, string> {
  if (values.scope !== "COMBO") return {};
  if (slots.length === 0) return { scope: copy.form.comboSlotsRequired };
  const errors: Record<string, string> = {};
  if (slots.some((slot) => !Number.isInteger(slot.quantity) || slot.quantity <= 0)) {
    errors.scope = copy.form.invalidComboQuantity;
  } else if (
    slots.some((slot) => slot.categoryIds.length === 0 && slot.menuItemIds.length === 0)
  ) {
    errors.scope = copy.form.comboSlotTargetRequired;
  }
  if (values.maxComboApplications.trim() !== "" && positiveCount(values.maxComboApplications) === null) {
    errors.maxComboApplications = copy.form.invalidMaxComboApplications;
  }
  return errors;
}

/** What the pickers and the builder currently hold, in one argument. */
interface FormTargets {
  categoryIds: string[];
  menuItemIds: string[];
  comboRequirements: ComboRequirement[];
}

/** The cross-field rules a per-input schema cannot express. */
function validate(
  values: DiscountFormValues,
  targets: FormTargets,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
): Record<string, string> {
  const slots = targets.comboRequirements;
  const errors: Record<string, string> = {
    ...checkValue(values, slots, formatters, copy),
    ...checkCombo(values, slots, copy),
  };
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
            comboRequirements: extra.comboRequirements,
            onCategoryIdsChange: extra.setCategoryIds,
            onMenuItemIdsChange: extra.setMenuItemIds,
            onComboRequirementsChange: extra.setComboRequirements,
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
