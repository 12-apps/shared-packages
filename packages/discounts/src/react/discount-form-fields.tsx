"use client";

import type { JSX } from "react";

import { Switch } from "@12-apps/ui/form/Switch";
import { Fields, useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

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

/**
 * A field with a sentence under it.
 *
 * `Fields.TextField` has no helper-text slot — deliberately, it is a thin bind
 * over `Input` — and two of the combo inputs are meaningless without one:
 * "itens grátis" and "combos por pedido" are both numbers whose UNIT an
 * operator cannot guess. So the caption is composed here rather than pushed
 * into `@12-apps/ui`, where it would be a prop every other consumer ignores.
 */
function HintedField({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint: string;
}): JSX.Element {
  return (
    <Stack spacing={0.5}>
      <Fields.TextField name={name} label={label} type="number" />
      <Text variant="caption">{hint}</Text>
    </Stack>
  );
}

/** One closed set as a toggle's options, labelled by the pack. */
function optionsFor<TKey extends string>(
  values: readonly TKey[],
  labels: Readonly<Record<TKey, string>>,
): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/**
 * The reward, in whichever unit the chosen type actually stores.
 *
 * One input per type, and the wrong one must never be mounted: the four value
 * columns are mutually exclusive at the database (`discounts_value_check`), so
 * a leftover value from another branch is a 500 on a form the operator filled
 * in correctly. Mounting rather than hiding is what guarantees it — an unmounted
 * field cannot carry a stale number to submit.
 *
 * The two combo rewards read differently from the two plain ones, and that is
 * the whole point of FUT-268: BUNDLE_PRICE is what the matched group COSTS
 * ("2 refrigerantes, 2 hambúrgueres e 2 batatas por R$ 49,90"), FREE_UNITS is
 * how many of the matched units are given away ("leve 3, pague 2"). Both are
 * money-or-count fields like the two above them; what makes them combos is the
 * scope, and the scope is what the builder below hangs off.
 */
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
  if (values.type === "BUNDLE_PRICE") {
    return <Currency name="bundlePrice" label={copy.form.bundlePrice} />;
  }
  if (values.type === "FREE_UNITS") {
    return (
      <HintedField name="freeUnits" label={copy.form.freeUnits} hint={copy.form.freeUnitsHint} />
    );
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

/**
 * How many times one cart may claim the combo.
 *
 * Only at COMBO scope, because it is the only scope where the question means
 * anything: an order-wide or category discount applies once by construction. A
 * blank field is "as often as it fits", which is the merchant's usual answer
 * and therefore the default rather than a number they have to type.
 */
function ComboCapField({ copy }: { copy: DiscountsWebCopy }): JSX.Element | null {
  const { values } = useFormContext();
  if (values.scope !== "COMBO") return null;
  return (
    <HintedField
      name="maxComboApplications"
      label={copy.form.maxComboApplications}
      hint={copy.form.maxComboApplicationsHint}
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
      <ComboCapField copy={copy} />
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
