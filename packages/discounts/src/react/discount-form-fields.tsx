"use client";

import type { JSX } from "react";

import { Switch } from "@12-apps/ui/form/Switch";
import { Fields, useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";

import { DISCOUNT_SCOPES, DISCOUNT_TRIGGERS, DISCOUNT_TYPES } from "../engine/kinds";

import type { DiscountsWebCopy } from "./copy";

/**
 * The form's inputs, split from the form itself for the 400-line file gate —
 * comments count toward it, and the container plus these would not fit.
 *
 * Every option list is built FROM the vocabulary arrays rather than spelled out
 * again: those arrays back the database's CHECK constraints, so an option an
 * operator can pick is by construction a value the column will store. A
 * hand-written list is how a form offers a fifth type the database refuses.
 */

/** One closed set as a toggle's options, labelled by the pack. */
function optionsFor<TKey extends string>(
  values: readonly TKey[],
  labels: Readonly<Record<TKey, string>>,
): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** Percentage or amount — whichever the chosen type actually stores. */
function ValueField({
  copy,
  currencyField,
}: {
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element {
  const { values } = useFormContext();
  const Currency = currencyField;
  if (values.type === "FIXED_AMOUNT") {
    return <Currency name="amountOff" label={copy.form.amountOff} />;
  }
  return (
    <Fields.TextField
      name="percentOff"
      label={copy.form.percentOff}
      placeholder={copy.form.percentPlaceholder}
    />
  );
}

/**
 * A money input, supplied by the host.
 *
 * Currency entry is a host decision — masking, the symbol's side, whether cents
 * are typed or implied — and `@12-apps/ui` has no opinionated one. So the
 * surface takes the component rather than shipping a guess; a host with nothing
 * special passes a plain text field.
 */
export type CurrencyFieldComponent = (props: { name: string; label: string }) => JSX.Element;

/** The coupon input, shown only for a CODE-triggered rule. */
function CodeField({ copy }: { copy: DiscountsWebCopy }): JSX.Element | null {
  const { values } = useFormContext();
  if (values.trigger !== "CODE") return null;
  return (
    <Fields.TextField
      name="code"
      label={copy.form.code}
      placeholder={copy.form.codePlaceholder}
    />
  );
}

/** Type + value + trigger + code, the four that decide WHAT and HOW. */
export function RuleFields({
  copy,
  currencyField,
}: {
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element {
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
      <Fields.ToggleField
        name="type"
        label={copy.form.type}
        options={optionsFor(DISCOUNT_TYPES, copy.labels.type)}
      />
      <ValueField copy={copy} currencyField={currencyField} />
      <Fields.ToggleField
        name="trigger"
        label={copy.form.trigger}
        options={optionsFor(DISCOUNT_TRIGGERS, copy.labels.trigger)}
      />
      <CodeField copy={copy} />
    </Box>
  );
}

/** The scope toggle, which decides which target picker is shown below it. */
export function ScopeField({ copy }: { copy: DiscountsWebCopy }): JSX.Element {
  return (
    <Fields.ToggleField
      name="scope"
      label={copy.form.scope}
      options={optionsFor(DISCOUNT_SCOPES, copy.labels.scope)}
    />
  );
}

/** The active window. Both sides optional; the end date is EXCLUSIVE. */
export function WindowFields({ copy }: { copy: DiscountsWebCopy }): JSX.Element {
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
      <Fields.TextField name="startsAt" label={copy.form.startsAt} type="date" />
      <Fields.TextField name="endsAt" label={copy.form.endsAt} type="date" />
    </Box>
  );
}

/** The minimum basket and the two redemption caps. */
export function LimitFields({
  copy,
  currencyField,
}: {
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element {
  const Currency = currencyField;
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" } }}>
      <Currency name="minSubtotal" label={copy.form.minSubtotal} />
      <Fields.TextField name="usageLimit" label={copy.form.usageLimit} type="number" />
      <Fields.TextField name="perBuyerLimit" label={copy.form.perBuyerLimit} type="number" />
    </Box>
  );
}

/** The two booleans, owned by the parent so submit can send them. */
export function DiscountSwitches({
  copy,
  active,
  stackable,
  onActive,
  onStackable,
}: {
  copy: DiscountsWebCopy;
  active: boolean;
  stackable: boolean;
  onActive: (next: boolean) => void;
  onStackable: (next: boolean) => void;
}): JSX.Element {
  return (
    <Stack spacing={1}>
      <Switch
        checked={active}
        onChange={(event) => onActive(event.target.checked)}
        label={copy.form.active}
        description={copy.form.activeHint}
        dataTestId="discount-active"
      />
      <Switch
        checked={stackable}
        onChange={(event) => onStackable(event.target.checked)}
        label={copy.form.stackable}
        description={copy.form.stackableHint}
        dataTestId="discount-stackable"
      />
    </Stack>
  );
}
