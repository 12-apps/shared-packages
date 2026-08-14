'use client';

import React from 'react';

import { CategorySelect } from '../../CategorySelect';
import type { CategorySelectOption } from '../../CategorySelect';
import { useFormContext } from '../FormContext';

/** Props for the `total-form` {@link CategoryField}. */
export interface CategoryFieldProps {
  /** Field name; also the key into the form's values/errors. */
  name: string;
  /** The categories to choose from, flat, each carrying its `parentId`. */
  options: CategorySelectOption[];
  /** Optional visible label rendered above the control. */
  label?: string;
  /** Placeholder shown while nothing is chosen. */
  placeholder?: string;
  /** Lets a top-level category be chosen in its own right (default: `true`). */
  allowParentSelection?: boolean;
}

/**
 * Category picker bound to {@link useFormContext}.
 *
 * The sibling {@link SelectField} flattens a category tree into one list, which
 * is the thing the hierarchical picker exists to stop. Use this wherever the
 * field's options nest.
 *
 * Form values are strings, so "nothing chosen" travels as `""` — mapped to and
 * from the control's `null` here rather than making every caller do it.
 */
export function CategoryField({
  name,
  options,
  label,
  placeholder,
  allowParentSelection = true,
}: CategoryFieldProps): React.ReactElement {
  const { values, errors, setFieldValue } = useFormContext();
  const error = errors[name];

  return (
    <CategorySelect
      mode="single"
      fullWidth
      label={label}
      placeholder={placeholder}
      options={options}
      allowParentSelection={allowParentSelection}
      value={values[name] ? values[name] : null}
      error={error}
      onChange={(next) => setFieldValue(name, next ?? '')}
      dataTestId={`total-form-field-${name}`}
    />
  );
}
