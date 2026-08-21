"use client";

import { useState, type JSX } from "react";

import { Autocomplete } from "@12-apps/ui/form/Autocomplete";
import { CategorySelect } from "@12-apps/ui/form/CategorySelect";
import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";

import type { WireTarget, WireTargetGroup } from "./api";

/**
 * One collection's picker, in the two shapes a collection can take.
 *
 * Its own module because BOTH callers need it and they are not each other's
 * parent: the scope-driven block renders one per discount, and the combo
 * builder renders one per collection per GROUP. Importing it from either would
 * make the two files a cycle, and copying it is how a nesting collection ends
 * up a flat combobox in one of the two places — the exact bug this seam exists
 * to prevent.
 *
 * There is no shared multi-select in `@12-apps/ui`, so the flat case composes
 * `Autocomplete` in multiple mode — chips plus type-to-filter, the same control
 * `AddressAutocomplete` is built on. A collection that NESTS gets
 * `CategorySelect` instead: a flat combobox would put a subcategory beside its
 * parent with nothing to tell them apart.
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
  requiredMessage: string | undefined;
  options: readonly WireTarget[];
  ids: readonly string[];
  onChange: (next: string[]) => void;
  dataTestId: string;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const byId = new Map(options.map((option) => [option.id, option]));
  // An id whose option is missing — a target archived since the rule was saved
  // — still renders as a chip, so saving cannot silently drop it.
  const selected = ids.map((id) => byId.get(id) ?? { id, name: id });

  const missing = requiredMessage !== undefined && ids.length === 0;

  return (
    <FormControl fullWidth>
      <FormLabel error={missing}>{label}</FormLabel>
      <div data-testid={dataTestId}>
        <Autocomplete<WireTarget>
          multiple
          value={query}
          onChange={setQuery}
          suggestions={[...options]}
          selectedItems={selected}
          onSelectedItemsChange={(items) => onChange(items.map((item) => item.id))}
          getKey={(option) => option.id}
          getLabel={(option) => option.name}
          placeholder={placeholder}
          inputAriaLabel={label}
        />
      </div>
      {missing && (
        <FormMessage error dataTestId={`${dataTestId}-message`}>
          {requiredMessage}
        </FormMessage>
      )}
    </FormControl>
  );
}

/**
 * One collection's picker, for whoever is asking.
 *
 * Extracted because the COMBO builder needs the same control per GROUP, and a
 * second copy is how a nesting collection ends up rendered as a flat combobox
 * in one of the two places — the bug this seam exists to prevent. The caller
 * supplies the label and the test id, because "Categorias com desconto" and
 * "Categorias deste grupo" are different sentences about the same control.
 *
 * `requiredMessage` is OPTIONAL, and that is the difference between the two
 * callers rather than an oversight. At CATEGORY/ITEM scope an empty picker IS
 * the error, so the message hangs on it. Inside a combo group it is not: a
 * group naming two categories and no items is complete, so the group as a whole
 * carries the refusal and neither picker does.
 */
export function TargetPickerField({
  group,
  label,
  placeholder,
  requiredMessage,
  ids,
  onChange,
  dataTestId,
}: {
  group: WireTargetGroup;
  label: string;
  placeholder: string;
  requiredMessage: string | undefined;
  ids: readonly string[];
  onChange: (next: string[]) => void;
  dataTestId: string;
}): JSX.Element {
  if (group.nests) {
    return (
      <CategorySelect
        label={label}
        fullWidth
        allowParentSelection
        options={[...group.targets]}
        value={[...ids]}
        onChange={onChange}
        error={requiredMessage !== undefined && ids.length === 0 ? requiredMessage : undefined}
        dataTestId={dataTestId}
      />
    );
  }
  return (
    <TargetField
      label={label}
      placeholder={placeholder}
      requiredMessage={requiredMessage}
      options={group.targets}
      ids={ids}
      onChange={onChange}
      dataTestId={dataTestId}
    />
  );
}

