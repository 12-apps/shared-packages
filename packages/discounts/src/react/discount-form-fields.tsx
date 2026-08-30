"use client";

import type { JSX } from "react";

import { FormControl, FormLabel } from "@12-apps/ui/form/Form";
import { Switch } from "@12-apps/ui/form/Switch";
import { Fields, useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { DISCOUNT_TRIGGERS } from "../engine/kinds";
import type { DiscountSchedule } from "../engine/schedule";

import type { DiscountsWebCopy } from "./copy";
import { COMBO_REWARDS, isComboKind, SELECTABLE_DISCOUNT_SCOPES, type DiscountKind } from "./form-kind";
import { ScheduleBuilder } from "./schedule-builder";

/**
 * The form's inputs, split from the form itself for the 400-line file gate —
 * comments count toward it, and the container plus these would not fit.
 *
 * Every option list is built FROM a vocabulary array rather than spelled out
 * again: those arrays back the database's CHECK constraints, so an option an
 * operator can pick is by construction a value the column will store. A
 * hand-written list is how a form offers a fifth type the database refuses.
 *
 * The KIND is what the form asks first, and every other input here is a
 * consequence of it (see `./form-kind` for the mapping and why it exists). That
 * is the difference from the version this replaces, where type and scope were
 * two free choices and most of their sixteen combinations were not offers.
 */

/**
 * A field with a sentence under it.
 *
 * `Fields.TextField` has no helper-text slot — deliberately, it is a thin bind
 * over `Input` — and the combo cap is meaningless without one: "combos por
 * pedido" is a number whose blank value an operator cannot guess.
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
 * A money input, supplied by the host.
 *
 * Currency entry is a host decision — masking, the symbol's side, whether cents
 * are typed or implied — and `@12-apps/ui` has no opinionated one. So the
 * surface takes the component rather than shipping a guess; a host with nothing
 * special passes a plain text field.
 */
export type CurrencyFieldComponent = (props: { name: string; label: string }) => JSX.Element;

/**
 * What kind of promotion this is — the form's first and most consequential
 * question, and the only one that decides what the rest of it looks like.
 *
 * The option list comes from the caller rather than from the constant, because
 * it is one longer when a legacy `BUNDLE_PRICE` rule is being edited.
 */
export function KindField({
  copy,
  kinds,
}: {
  copy: DiscountsWebCopy;
  kinds: readonly DiscountKind[];
}): JSX.Element {
  return (
    <Fields.ToggleField
      name="kind"
      label={copy.form.kind}
      options={optionsFor(kinds, copy.labels.kind)}
    />
  );
}

/**
 * A combo's reward: which of the two, and how much.
 *
 * Both are here rather than split between the top of the form and the bottom,
 * because to a merchant they are one sentence — "este combo dá 15% de
 * desconto". The two are the ONLY rewards a combo can give: a flat bundle price
 * reprices the group and goes silently wrong the first time one of its items
 * changes price, so it is not offered (see `./form-kind`).
 */
function ComboRewardFields({
  copy,
  currencyField,
}: {
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element {
  const { values } = useFormContext();
  const Currency = currencyField;
  return (
    <Stack spacing={0.5}>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <Fields.ToggleField
          name="comboReward"
          label={copy.form.comboReward}
          options={optionsFor(COMBO_REWARDS, copy.labels.type)}
        />
        {values.comboReward === "FIXED_AMOUNT" ? (
          <Currency name="amountOff" label={copy.form.amountOff} />
        ) : (
          <Fields.TextField
            name="percentOff"
            label={copy.form.percentOff}
            placeholder={copy.form.percentPlaceholder}
          />
        )}
      </Box>
      <Text variant="caption">{copy.form.comboRewardHint}</Text>
    </Stack>
  );
}

/**
 * The reward, in whichever unit the chosen KIND actually stores.
 *
 * One input per kind, and the wrong one must never be mounted: the four value
 * columns are mutually exclusive at the database (`discounts_value_check`), so
 * a leftover value from another branch is a 500 on a form the operator filled
 * in correctly. Mounting rather than hiding is what guarantees it — an
 * unmounted field cannot carry a stale number to submit.
 *
 * `FREE_UNITS` is the one kind with nothing here: its reward is a count of the
 * units it gives away, which only reads as an offer beside the units it takes,
 * so the free-units builder carries both.
 */
export function RewardFields({
  copy,
  currencyField,
}: {
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element | null {
  const { values } = useFormContext();
  const Currency = currencyField;
  const kind = values.kind ?? "PERCENTAGE";
  if (kind === "COMBO") return <ComboRewardFields copy={copy} currencyField={currencyField} />;
  if (kind === "FREE_UNITS") return null;
  if (kind === "BUNDLE_PRICE") return <Currency name="bundlePrice" label={copy.form.bundlePrice} />;
  if (kind === "FIXED_AMOUNT") return <Currency name="amountOff" label={copy.form.amountOff} />;
  return (
    <Fields.TextField
      name="percentOff"
      label={copy.form.percentOff}
      placeholder={copy.form.percentPlaceholder}
    />
  );
}

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

/** What makes the promotion fire, and the code it fires on. */
export function TriggerFields({ copy }: { copy: DiscountsWebCopy }): JSX.Element {
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
      <Fields.ToggleField
        name="trigger"
        label={copy.form.trigger}
        options={optionsFor(DISCOUNT_TRIGGERS, copy.labels.trigger)}
      />
      <CodeField copy={copy} />
    </Box>
  );
}

/**
 * What the discount covers — and ONLY for the kinds where that is a question.
 *
 * A combo covers the groups it is made of, so `COMBO` scope is not one of four
 * choices, it is what those two kinds mean. Offering it anyway is what let an
 * operator build "preço de combo, abrangência: pedido" and have the write path
 * refuse it.
 */
export function ScopeField({ copy }: { copy: DiscountsWebCopy }): JSX.Element | null {
  const { values } = useFormContext();
  if (isComboKind(values.kind ?? "PERCENTAGE")) return null;
  return (
    <Fields.ToggleField
      name="scope"
      label={copy.form.scope}
      options={optionsFor(SELECTABLE_DISCOUNT_SCOPES, copy.labels.scope)}
    />
  );
}

/**
 * How many times one cart may claim the combo.
 *
 * Only for a combo kind, because it is the only place the question means
 * anything: an order-wide or category discount applies once by construction. A
 * blank field is "as often as it fits", which is the merchant's usual answer
 * and therefore the default rather than a number they have to type.
 *
 * It sits with the builder rather than with the redemption limits next to it:
 * "combos por pedido" is a fact about THIS combo, and among "limite de usos"
 * and "limite por cliente" it read as a third redemption cap.
 */
export function ComboCapField({ copy }: { copy: DiscountsWebCopy }): JSX.Element | null {
  const { values } = useFormContext();
  const kind = values.kind ?? "PERCENTAGE";
  if (!isComboKind(kind)) return null;
  return (
    <HintedField
      name="maxComboApplications"
      // Same column, same rule, two words for it: nobody calls "leve 3, pague
      // 2" a combo, so "Combos por pedido" reads as a control for a promotion
      // the operator is not creating.
      label={
        kind === "FREE_UNITS"
          ? copy.form.maxFreeUnitsApplications
          : copy.form.maxComboApplications
      }
      hint={copy.form.maxComboApplicationsHint}
    />
  );
}

/**
 * "Quando vale" — the campaign PERIOD, and the weekly schedule inside it
 * (FUT-996).
 *
 * The two are one section because they answer one question in two halves, and
 * an operator reads them together: "de setembro a novembro" and "toda sexta,
 * das 16 às 20" describe the same promotion. They were a bare pair of date
 * inputs before there was a second half to pair with.
 *
 * Repetition defaults to "Sempre", so every rule that predates this and every
 * simple new one is untouched — an operator creating a plain 10%-off never sees
 * the builder. That default is what keeps the screen from getting harder for
 * the promotions nobody schedules.
 */
export function WindowFields({
  copy,
  schedule,
  scheduleEnabled,
  timezoneLabel,
  onScheduleChange,
  onScheduleEnabledChange,
}: {
  copy: DiscountsWebCopy;
  schedule: DiscountSchedule;
  scheduleEnabled: boolean;
  timezoneLabel: string | null;
  onScheduleChange: (next: DiscountSchedule) => void;
  onScheduleEnabledChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <Stack spacing={1.5}>
      <Text variant="heading">{copy.schedule.sectionTitle}</Text>
      <Stack spacing={0.5}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
          <Fields.TextField name="startsAt" label={copy.form.startsAt} type="date" />
          <Fields.TextField name="endsAt" label={copy.form.endsAt} type="date" />
        </Box>
        <Text variant="caption">{copy.schedule.periodHint}</Text>
      </Stack>
      <FormControl>
        <FormLabel>{copy.schedule.repetitionTitle}</FormLabel>
        <Stack spacing={0.5}>
          {[
            [false, copy.schedule.always] as const,
            [true, copy.schedule.specific] as const,
          ].map(([value, label]) => (
            <label key={label} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                name="discount-repetition"
                checked={scheduleEnabled === value}
                onChange={() => onScheduleEnabledChange(value)}
                data-testid={value ? "repetition-specific" : "repetition-always"}
              />
              <Text variant="body">{label}</Text>
            </label>
          ))}
        </Stack>
      </FormControl>
      {scheduleEnabled && (
        <>
          <ScheduleBuilder
            schedule={schedule}
            copy={copy}
            timezone={timezoneLabel ?? ""}
            onChange={onScheduleChange}
          />
          <OrderScopeScheduleNote copy={copy} />
        </>
      )}
    </Stack>
  );
}

/**
 * The ORDER-scope asymmetry, at the point of confusion.
 *
 * An order-wide rule has no line to anchor a schedule to, so it is judged at
 * CHECKOUT while every other scope is judged per line — which means a cart
 * straddling 20:00 behaves differently under "10% em tudo" than under "10% em
 * cervejas". That is a real difference and an invisible one, so it is said
 * here, only for the combination that has it, rather than left in a document
 * nobody opens while filling in a form.
 */
function OrderScopeScheduleNote({ copy }: { copy: DiscountsWebCopy }): JSX.Element | null {
  const { values } = useFormContext();
  const kind = values.kind ?? "PERCENTAGE";
  if (isComboKind(kind) || values.scope !== "ORDER") return null;
  return <Text variant="caption">{copy.schedule.orderScopeNote}</Text>;
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
