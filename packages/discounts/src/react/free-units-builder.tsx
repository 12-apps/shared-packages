"use client";

import type { JSX } from "react";

import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ComboRequirement } from "../engine/types";

import type { WireTargetGroup } from "./api";
import { blankSlot } from "./combo-slot-builder";
import { fill, type DiscountsWebCopy } from "./copy";
import { TargetPickerField } from "./target-picker-field";

/**
 * "Leve 3, pague 2" — the free-units builder (FUT-268).
 *
 * Underneath it is a combo like any other: ONE group of three units, one of
 * which is free. But an operator describing "leve 3, pague 2" is not building a
 * combo, and making them add a group, name it, and then find `freeUnits`
 * somewhere else turns a one-sentence offer into the hardest form on the
 * screen. So this kind gets a shape of its own: how many the customer takes,
 * which products count, how many are free.
 *
 * **Products only, never categories.** A single group is the whole promotion
 * here, so "the customer takes 3" has to name things the customer recognises.
 * The multi-group builder next door still offers both collections — there a
 * group naming a category is exactly right ("2 refrigerantes").
 *
 * The state it edits is the same `ComboRequirement[]` the combo builder edits,
 * with the list capped at one. That is what lets the two kinds share a
 * validator, a write path and a stored shape: switching a rule between them
 * changes which control is on screen, not what is saved.
 */

/** The one group this kind edits, or a blank one when nothing is chosen yet. */
function onlySlot(slots: readonly ComboRequirement[]): ComboRequirement {
  return slots[0] ?? blankSlot();
}

/** How many the customer pays for: what they take, minus what is free. */
function paidUnits(taken: number, free: number): number {
  return Math.max(taken - free, 0);
}

/**
 * The read-back sentence, in the operator's own numbers.
 *
 * Only once BOTH numbers make one — "leve 3, pague 0" is a giveaway and "leve
 * 1, pague 1" is not a promotion, and the validator refuses both. Showing the
 * sentence anyway would read as confirmation of an offer that cannot be saved.
 */
function summaryOf(taken: number, free: number, copy: DiscountsWebCopy): string | null {
  if (!Number.isInteger(taken) || taken < 2 || !Number.isInteger(free) || free < 1) return null;
  if (free >= taken) return null;
  return fill(copy.combo.freeUnitsSummary, { units: taken, paid: paidUnits(taken, free) });
}

/**
 * The two numbers that ARE the offer: how many the customer takes, and how many
 * of those are free.
 *
 * Split from the builder purely for the function-size gate, but the seam is the
 * right one anyway — this pair is the sentence, and the picker below it is the
 * list of things the sentence is about.
 */
function FreeUnitsCounts({
  quantity,
  freeUnits,
  copy,
  error,
  onQuantity,
  onFreeUnits,
}: {
  quantity: number;
  freeUnits: string;
  copy: DiscountsWebCopy;
  error: string | undefined;
  onQuantity: (next: number) => void;
  onFreeUnits: (next: string) => void;
}): JSX.Element {
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
      <Input
        type="number"
        label={copy.combo.buyQuantity}
        value={String(quantity)}
        onChange={(event) => onQuantity(Number(event.target.value))}
        data-testid="free-units-quantity"
      />
      <Input
        type="number"
        label={copy.form.freeUnits}
        value={freeUnits}
        onChange={(event) => onFreeUnits(event.target.value)}
        error={error !== undefined}
        data-testid="free-units-free"
      />
    </Box>
  );
}

export function FreeUnitsBuilder({
  slots,
  groups,
  copy,
  freeUnits,
  error,
  onChange,
  onFreeUnitsChange,
}: {
  slots: readonly ComboRequirement[];
  groups: readonly WireTargetGroup[];
  copy: DiscountsWebCopy;
  /** The reward, as typed. Held by the form so the validator can read it. */
  freeUnits: string;
  /**
   * The validator's refusal for that reward, since the input above is a raw
   * `Input` rather than a bound `Fields.TextField` — a bound field would paint
   * this itself, but it would also sit outside the sentence it belongs to.
   */
  error: string | undefined;
  onChange: (next: ComboRequirement[]) => void;
  onFreeUnitsChange: (next: string) => void;
}): JSX.Element | null {
  const items = groups.find((group) => group.targetType === "ITEM");
  if (!items) return null;

  const slot = onlySlot(slots);
  const summary = summaryOf(slot.quantity, Number(freeUnits), copy);
  const empty = slot.menuItemIds.length === 0;

  return (
    <FormControl fullWidth>
      <FormLabel>{copy.combo.freeUnitsTitle}</FormLabel>
      <Text variant="caption">{copy.combo.freeUnitsHint}</Text>
      <Stack spacing={2} sx={{ mt: 1 }} data-testid="free-units-builder">
        <FreeUnitsCounts
          quantity={slot.quantity}
          freeUnits={freeUnits}
          copy={copy}
          error={error}
          onQuantity={(quantity) => onChange([{ ...slot, quantity }])}
          onFreeUnits={onFreeUnitsChange}
        />
        <TargetPickerField
          group={items}
          label={fill(copy.combo.freeUnitsPick, { collection: items.label })}
          placeholder={fill(copy.targets.search, { collection: items.label })}
          // The refusal is the BUILDER's, not the picker's — the same call the
          // multi-group builder makes, so the two read alike when a rule is
          // switched between them.
          requiredMessage={undefined}
          ids={slot.menuItemIds}
          onChange={(ids) => onChange([{ ...slot, menuItemIds: ids }])}
          copy={copy.categorySelect}
          dataTestId="free-units-items"
        />
        {error !== undefined && (
          <FormMessage error dataTestId="free-units-free-message">
            {error}
          </FormMessage>
        )}
        {empty ? (
          <FormMessage error dataTestId="free-units-message">
            {copy.form.freeUnitsTargetRequired}
          </FormMessage>
        ) : null}
        {summary !== null && (
          <Text variant="caption" data-testid="free-units-summary">
            {summary}
          </Text>
        )}
      </Stack>
    </FormControl>
  );
}
