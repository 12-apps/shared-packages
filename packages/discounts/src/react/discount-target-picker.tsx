"use client";

import { useState, type JSX } from "react";

import { Autocomplete } from "@12-apps/ui/form/Autocomplete";
import { CategorySelect } from "@12-apps/ui/form/CategorySelect";
import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { useFormContext } from "@12-apps/ui/form/total-form";

import { fill, type DiscountsWebCopy } from "./copy";
import type { WireTarget, WireTargetGroup } from "./api";

/**
 * What a scoped discount points at, picked from the host's own collections.
 *
 * There is no shared multi-select in `@12-apps/ui`, so this composes
 * `Autocomplete` in multiple mode — chips plus type-to-filter, the same control
 * `AddressAutocomplete` is built on. A collection that NESTS gets
 * `CategorySelect` instead: a flat combobox would put a subcategory beside its
 * parent with nothing to tell them apart.
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

/** One labelled multi-select of targets, with its own input-text state. */
function TargetField({
  label,
  placeholder,
  requiredMessage,
  options,
  ids,
  onChange,
  dataTestId,
}: {
  label: string;
  placeholder: string;
  requiredMessage: string;
  options: WireTarget[];
  ids: readonly string[];
  onChange: (next: string[]) => void;
  dataTestId: string;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const byId = new Map(options.map((option) => [option.id, option]));
  // An id whose option is missing — a target archived since the rule was saved
  // — still renders as a chip, so saving cannot silently drop it.
  const selected = ids.map((id) => byId.get(id) ?? { id, name: id });

  return (
    <FormControl fullWidth>
      <FormLabel error={ids.length === 0}>{label}</FormLabel>
      <div data-testid={dataTestId}>
        <Autocomplete<WireTarget>
          multiple
          value={query}
          onChange={setQuery}
          suggestions={options}
          selectedItems={selected}
          onSelectedItemsChange={(items) => onChange(items.map((item) => item.id))}
          getKey={(option) => option.id}
          getLabel={(option) => option.name}
          placeholder={placeholder}
          inputAriaLabel={label}
        />
      </div>
      {ids.length === 0 && (
        <FormMessage error dataTestId={`${dataTestId}-message`}>
          {requiredMessage}
        </FormMessage>
      )}
    </FormControl>
  );
}

/** The ids currently chosen for one dimension. */
interface DiscountTargetSelection {
  categoryIds: string[];
  menuItemIds: string[];
  onCategoryIdsChange: (next: string[]) => void;
  onMenuItemIdsChange: (next: string[]) => void;
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
 * The scope-driven target block.
 *
 * Reads the LIVE `scope` from the form context, so flipping the toggle swaps
 * the picker immediately without the parent form having to mirror the value
 * into its own state.
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
  const { values } = useFormContext();
  const scope = values.scope ?? "ORDER";
  const group = groups.find((entry) => scopeFor(entry.targetType) === scope);
  if (!group) return null;

  const { ids, onChange } = bind(group.targetType, selection);
  const label = fill(copy.targets.pick, { collection: group.label });
  const dataTestId = `discount-${group.slug}-targets`;

  if (group.nests) {
    return (
      <CategorySelect
        label={label}
        fullWidth
        allowParentSelection
        options={group.targets}
        value={ids}
        onChange={onChange}
        error={ids.length === 0 ? copy.targets.required : undefined}
        dataTestId={dataTestId}
      />
    );
  }
  return (
    <TargetField
      label={label}
      placeholder={fill(copy.targets.search, { collection: group.label })}
      requiredMessage={copy.targets.required}
      options={group.targets}
      ids={ids}
      onChange={onChange}
      dataTestId={dataTestId}
    />
  );
}
