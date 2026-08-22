"use client";

import type { JSX } from "react";

import { useFormContext } from "@12-apps/ui/form/total-form";

import type { ComboRequirement } from "../engine/types";

import type { WireTargetGroup } from "./api";
import { ComboSlotBuilder } from "./combo-slot-builder";
import { fill, type DiscountsWebCopy } from "./copy";
import { FreeUnitsBuilder } from "./free-units-builder";
import { TargetPickerField } from "./target-picker-field";

/**
 * What a scoped discount points at, picked from the host's own collections.
 *
 * This file is the ROUTER: it reads the KIND and decides which shape the
 * targets take. The controls themselves live next door — one collection's
 * picker in `target-picker-field`, the quantified group list in
 * `combo-slot-builder`, the one-group "leve 3, pague 2" in
 * `free-units-builder` — because the builders need the picker per group and a
 * file cannot import its own importer.
 *
 * Which collections exist is not decided here. The surface reads them from
 * `GET /discounts/targets`, which answers whatever the host registered — so
 * adding a third discountable dimension is a host-side registration and this
 * file does not change.
 *
 * The selection is held by the PARENT form, outside `FormContainer`, and merged
 * in at submit: `total-form` values are strings and an id list is not one.
 *
 * The whole block renders `null` at ORDER scope. An order-wide discount covers
 * everything, so a target list there is not "empty" — it is meaningless, and
 * leaving a stale one on screen would suggest otherwise.
 */

/** What the form currently has chosen, in every shape a scope can need. */
interface DiscountTargetSelection {
  categoryIds: string[];
  menuItemIds: string[];
  /** The combo's groups, in the operator's own order. Empty at every other scope. */
  comboRequirements: readonly ComboRequirement[];
  onCategoryIdsChange: (next: string[]) => void;
  onMenuItemIdsChange: (next: string[]) => void;
  onComboRequirementsChange: (next: ComboRequirement[]) => void;
}

/** Which selection a dimension reads and writes. */
function bind(
  targetType: string,
  selection: DiscountTargetSelection,
): { ids: string[]; onChange: (next: string[]) => void } {
  if (targetType === "CATEGORY") {
    return { ids: selection.categoryIds, onChange: selection.onCategoryIdsChange };
  }
  return { ids: selection.menuItemIds, onChange: selection.onMenuItemIdsChange };
}

/** The scope a collection's picker is shown at. */
function scopeFor(targetType: string): string {
  return targetType === "CATEGORY" ? "CATEGORY" : "ITEM";
}

/**
 * The kind-driven target block.
 *
 * Reads the LIVE `kind` and `scope` from the form context, so flipping either
 * toggle swaps the control immediately without the parent form having to mirror
 * the value into its own state.
 *
 * The two combo kinds are a different SHAPE, not another picker (FUT-268): a
 * combo is a list of quantified groups, so it gets a builder and every
 * collection at once, while CATEGORY and ITEM each get exactly one collection's
 * picker. ORDER renders nothing — an order-wide discount covers everything, so
 * a target list there is not empty, it is meaningless.
 */
export function DiscountTargetPicker({
  groups,
  copy,
  selection,
}: {
  groups: readonly WireTargetGroup[];
  copy: DiscountsWebCopy;
  selection: DiscountTargetSelection;
}): JSX.Element | null {
  const { values, errors, setFieldValue } = useFormContext();
  const kind = values.kind ?? "PERCENTAGE";
  const scope = values.scope ?? "ORDER";

  if (kind === "FREE_UNITS") {
    return (
      <FreeUnitsBuilder
        slots={selection.comboRequirements}
        groups={groups}
        copy={copy}
        freeUnits={values.freeUnits ?? ""}
        error={errors.freeUnits}
        onChange={selection.onComboRequirementsChange}
        onFreeUnitsChange={(next) => setFieldValue("freeUnits", next)}
      />
    );
  }

  if (kind === "COMBO" || kind === "BUNDLE_PRICE") {
    return (
      <ComboSlotBuilder
        slots={selection.comboRequirements}
        groups={groups}
        copy={copy}
        onChange={selection.onComboRequirementsChange}
      />
    );
  }

  const group = groups.find((entry) => scopeFor(entry.targetType) === scope);
  if (!group) return null;

  const { ids, onChange } = bind(group.targetType, selection);
  return (
    <TargetPickerField
      group={group}
      label={fill(copy.targets.pick, { collection: group.label })}
      placeholder={fill(copy.targets.search, { collection: group.label })}
      requiredMessage={copy.targets.required}
      ids={ids}
      onChange={onChange}
      copy={copy.categorySelect}
      dataTestId={`discount-${group.slug}-targets`}
    />
  );
}
