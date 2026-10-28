"use client";

import { useRef, type JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ComboRequirement } from "../engine/types";

import type { WireTargetGroup } from "./api";
import { fill, type DiscountsWebCopy } from "./copy";
import { CountInput } from "./number-fields";
import { TargetPickerField } from "./target-picker-field";

/**
 * The combo builder — how an operator says "2 refrigerantes, 2 hambúrgueres e
 * 2 batatas" (FUT-268).
 *
 * A combo is a list of GROUPS. Each group is a quantity and the rows that can
 * fill it, and a cart matches the combo when every group is satisfiable at
 * once. That shape is already the engine's (`ComboRequirement`), the
 * validator's and the schema's — `discount_combo_slots` with its own targets —
 * so this file adds no concept. It adds the only thing that was missing: a way
 * to author one.
 *
 * Two decisions worth stating, because both are visible in the markup:
 *
 * **A group can name categories AND items at once.** "2 refrigerantes" is a
 * category; "2 batatas médias" is an item; and a real menu mixes them inside
 * one group ("any drink, or specifically the large fries"). So each group gets
 * every registered collection's picker rather than a scope toggle — the union
 * is what `ComboRequirement` already stores, and forcing a choice would make
 * the common offer unexpressible.
 *
 * **Position is the array index, and it is meaningful.** The list an operator
 * builds is the list a card reads back; two groups of the same size are
 * otherwise indistinguishable once stored. Removing a group therefore
 * renumbers the ones after it, which is what an operator expects from a list
 * they are editing — and `toTargetRows` stamps the index as `position` on the
 * way to the database.
 */

/** How many units one application of the combo takes out of the cart. */
export function comboUnits(slots: readonly ComboRequirement[]): number {
  return slots.reduce((total, slot) => total + (Number.isFinite(slot.quantity) ? slot.quantity : 0), 0);
}

/** "1 item" or "4 itens": the pack's one form for exactly 1, its other form otherwise. */
function counted(count: number, one: string, other: string): string {
  return fill(count === 1 ? one : other, { count });
}

/** The read-back sentence, both nouns in the right number. */
function comboSummary(slots: readonly ComboRequirement[], copy: DiscountsWebCopy): string {
  const { combo } = copy;
  return fill(combo.summary, {
    units: counted(comboUnits(slots), combo.unitsOne, combo.unitsOther),
    groups: counted(slots.length, combo.groupsOne, combo.groupsOther),
  });
}

/** An empty group: one unit, nothing chosen yet. */
export function blankSlot(): ComboRequirement {
  return { quantity: 1, categoryIds: [], menuItemIds: [] };
}

/**
 * One screen-only id per group, in list order (FUT-4143).
 *
 * A group has no id until the database gives it one, and an index key hands a
 * removed row's component — and its half-typed draft — to the row that moves
 * up. These ids live here and nowhere else: the wire still carries the plain
 * `ComboRequirement`s. Appends get a fresh id; a removal drops its own (see
 * `onRemove`); a list replaced from outside is padded or cut to length.
 */
function useRowIds(length: number): { current: number[] } {
  const ids = useRef<number[]>([]);
  const next = useRef(0);
  while (ids.current.length < length) {
    ids.current = [...ids.current, next.current];
    next.current += 1;
  }
  if (ids.current.length > length) ids.current = ids.current.slice(0, length);
  return ids;
}

/** Replace one group, leaving the rest (and their order) alone. */
function replaceAt(
  slots: readonly ComboRequirement[],
  index: number,
  next: ComboRequirement,
): ComboRequirement[] {
  return slots.map((slot, position) => (position === index ? next : slot));
}

/** Which id list of a group a collection reads and writes. */
function idsFor(slot: ComboRequirement, targetType: string): readonly string[] {
  return targetType === "CATEGORY" ? slot.categoryIds : slot.menuItemIds;
}

function withIds(slot: ComboRequirement, targetType: string, ids: string[]): ComboRequirement {
  return targetType === "CATEGORY" ? { ...slot, categoryIds: ids } : { ...slot, menuItemIds: ids };
}

/**
 * One group: its quantity, one picker per registered collection, and the
 * control that removes it.
 *
 * The quantity is a digits-only text box (`CountInput`, FUT-4143) rather than
 * `type="number"`, which read "2,5" by the browser's language — as 25 in an
 * English one. It is held as a NUMBER in state
 * rather than as the form's string, because the summary line above adds them up
 * and the validator compares them against `freeUnits`; parsing on every read
 * would put the same `Number()` in three places.
 */
function ComboSlotRow({
  slot,
  index,
  groups,
  copy,
  onChange,
  onRemove,
}: {
  slot: ComboRequirement;
  index: number;
  groups: readonly WireTargetGroup[];
  copy: DiscountsWebCopy;
  onChange: (next: ComboRequirement) => void;
  onRemove: () => void;
}): JSX.Element {
  const position = index + 1;
  const empty = slot.categoryIds.length === 0 && slot.menuItemIds.length === 0;
  return (
    <Box
      data-testid={`combo-slot-${index}`}
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Text weight="medium">{fill(copy.combo.slot, { position })}</Text>
        <Button
          variant="text"
          onClick={onRemove}
          // The label carries the POSITION, so a screen reader announces which
          // group this removes — "remove" alone is three identical buttons.
          aria-label={fill(copy.combo.removeSlot, { position })}
          data-testid={`combo-slot-${index}-remove`}
        >
          ✕
        </Button>
      </Stack>
      <Stack spacing={2} sx={{ mt: 1 }}>
        <CountInput
          label={copy.combo.quantity}
          value={slot.quantity}
          copy={copy}
          invalidMessage={copy.form.invalidComboQuantity}
          dataTestId={`combo-slot-${index}-quantity`}
          onChange={(quantity) => onChange({ ...slot, quantity })}
        />
        {groups.map((group) => (
          <TargetPickerField
            key={group.targetType}
            group={group}
            label={fill(copy.combo.pick, { collection: group.label })}
            placeholder={fill(copy.targets.search, { collection: group.label })}
            // The refusal belongs to the GROUP, not to either picker: a group
            // naming a category is complete even with no items in it. So the
            // message hangs below both, once, and only when both are empty.
            requiredMessage={undefined}
            ids={idsFor(slot, group.targetType)}
            onChange={(ids) => onChange(withIds(slot, group.targetType, ids))}
            copy={copy.categorySelect}
          autocompleteCopy={copy.autocomplete}
            dataTestId={`combo-slot-${index}-${group.slug}`}
          />
        ))}
        {empty && (
          <FormMessage error dataTestId={`combo-slot-${index}-message`}>
            {copy.form.comboSlotTargetRequired}
          </FormMessage>
        )}
      </Stack>
    </Box>
  );
}

/**
 * The whole builder: the heading, the groups, the add button and the read-back.
 *
 * The read-back line is not decoration. A combo is the one promotion whose
 * meaning is spread across several controls, and "the combo takes 6 items in 3
 * groups" is the sentence that catches a mistyped quantity before a save — the
 * same number `freeUnits` is validated against, computed once and shown.
 */
export function ComboSlotBuilder({
  slots,
  groups,
  copy,
  onChange,
}: {
  slots: readonly ComboRequirement[];
  groups: readonly WireTargetGroup[];
  copy: DiscountsWebCopy;
  onChange: (next: ComboRequirement[]) => void;
}): JSX.Element {
  const rowIds = useRowIds(slots.length);
  return (
    <FormControl fullWidth>
      <FormLabel>{copy.combo.title}</FormLabel>
      <Text variant="caption">{copy.combo.hint}</Text>
      <Stack spacing={2} sx={{ mt: 1 }} data-testid="combo-slots">
        {slots.map((slot, index) => (
          <ComboSlotRow
            // `position` is the array index, and removing a group renumbers
            // the rest — but the ROW is keyed by a screen-only id, so the
            // group below does not inherit the removed one's draft.
            key={rowIds.current[index]}
            slot={slot}
            index={index}
            groups={groups}
            copy={copy}
            onChange={(next) => onChange(replaceAt(slots, index, next))}
            onRemove={() => {
              rowIds.current = rowIds.current.filter((_, position) => position !== index);
              onChange(slots.filter((_, position) => position !== index));
            }}
          />
        ))}
        {slots.length === 0 && (
          <Text variant="caption" data-testid="combo-slots-empty">
            {copy.combo.empty}
          </Text>
        )}
        {/* Wraps as a ROW, never inside the button: where the note does not
            fit beside "Adicionar grupo" it takes the line below, and the
            button's own label stays on one line (FUT-4143 UI review). */}
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 2, rowGap: 1 }}>
          <Box sx={{ flexShrink: 0, "& > button": { whiteSpace: "nowrap" } }}>
            <Button
              variant="outline"
              onClick={() => onChange([...slots, blankSlot()])}
              data-testid="combo-add-slot"
            >
              {copy.combo.addSlot}
            </Button>
          </Box>
          {slots.length > 0 && (
            <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
              <Text variant="caption" data-testid="combo-summary">
                {comboSummary(slots, copy)}
              </Text>
            </Box>
          )}
        </Box>
      </Stack>
    </FormControl>
  );
}
