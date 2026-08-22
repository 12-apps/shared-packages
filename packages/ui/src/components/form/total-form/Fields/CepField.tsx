'use client';

import type { CepFieldCopy } from "../../../../copy";
import React, { useCallback, useMemo, useRef } from 'react';

import { CepField as BaseCepField, type CepAddress } from '../../CepField';
import { useFormContext } from '../FormContext';

/** The resolved address parts a form can receive. */
type CepPart = 'street' | 'neighborhood' | 'city' | 'state';

/**
 * Which form field receives each resolved part. Omit a part to leave it alone —
 * a form with no bairro column simply doesn't map `neighborhood`.
 */
export type CepFills = Partial<Record<CepPart, string>>;

/** Props for the `total-form` {@link CepField}. */
export interface CepFieldProps {
  /** The lookup status wording. REQUIRED — no default copy. */
  copy: CepFieldCopy;
  /** Field name; also the key into the form's values/errors. */
  name: string;
  /** Optional visible label. Defaults to `CEP`. */
  label?: string;
  /** Resolve a complete CEP. Omit for a masked input with no lookup. */
  lookup?: (cep: string) => Promise<CepAddress | null>;
  /** Maps each resolved address part onto a field in THIS form. */
  fills?: CepFills;
  /** Milliseconds to wait after the last keystroke before looking up. */
  debounceMs?: number;
}

const PARTS: readonly CepPart[] = ['street', 'neighborhood', 'city', 'state'];

/** Ownership-aware writes into sibling form fields. */
interface OwnedAutofill {
  /** Write one field, where `''` means "no value for this part". */
  write: (field: string, value: string) => void;
  /** Blank every field this hook still owns. */
  clearOwned: () => void;
}

/**
 * The honesty rule, in one place: this hook remembers exactly what it wrote,
 * writes only into fields that are empty or still hold its own value, and drops
 * the ownership record when it blanks one. That single invariant is what lets
 * autofill replace itself freely while never touching the user's typing.
 */
function useOwnedAutofill(): OwnedAutofill {
  const { values, setFieldValue } = useFormContext();
  // What we last auto-filled per target field, so a later lookup may replace
  // its own value while a manual edit is preserved.
  const autoFilledRef = useRef<Record<string, string>>({});
  // Read values at call time without making them a dependency of the callback.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const write = useCallback(
    (field: string, value: string) => {
      const current = (valuesRef.current[field] ?? '').trim();
      const ours = autoFilledRef.current[field] === current;
      if (current !== '' && !ours) return;
      setFieldValue(field, value);
      if (value) {
        autoFilledRef.current[field] = value;
      } else {
        delete autoFilledRef.current[field];
      }
    },
    [setFieldValue],
  );

  const clearOwned = useCallback(() => {
    // Object.keys snapshots, so `write` may delete entries as we iterate.
    for (const field of Object.keys(autoFilledRef.current)) {
      write(field, '');
    }
  }, [write]);

  return useMemo(() => ({ write, clearOwned }), [write, clearOwned]);
}

/**
 * CEP field bound to {@link useFormContext}: masks and validates the CEP, then
 * writes the resolved logradouro/bairro/cidade/UF straight into the sibling
 * fields named by `fills`.
 *
 * It will not overwrite work the user has done. A target field is only written
 * when it is empty, or when it still holds the exact value THIS component put
 * there — so correcting the CEP re-fills the address, but a hand-edited street
 * survives the next lookup.
 *
 * @example
 * ```tsx
 * <Fields.CepField
 *   name="postalCode"
 *   lookup={lookupCep}
 *   fills={{ street: 'addressLine1', neighborhood: 'neighborhood', city: 'city', state: 'state' }}
 * />
 * ```
 */
export function CepField({
  name,
  label,
  lookup,
  fills,
  debounceMs,
  copy,
}: CepFieldProps): React.ReactElement {
  const { values, errors, setFieldValue } = useFormContext();
  const { write, clearOwned } = useOwnedAutofill();

  const handleResolved = useCallback(
    (address: CepAddress) => {
      if (!fills) return;
      // Every mapped part is written on EVERY resolve, absent ones as ''. A
      // "CEP geral" (a small município's catch-all) carries no logradouro, so
      // skipping absent parts would leave the previous CEP's street here.
      for (const part of PARTS) {
        const field = fills[part];
        if (field) write(field, address[part] ?? '');
      }
    },
    [fills, write],
  );

  const handleChange = useCallback(
    (masked: string) => setFieldValue(name, masked),
    [name, setFieldValue],
  );

  return (
    <BaseCepField
      copy={copy}
      name={name}
      label={label}
      value={values[name] ?? ''}
      error={errors[name]}
      onChange={handleChange}
      onLookup={lookup}
      onResolved={handleResolved}
      onNotFound={clearOwned}
      debounceMs={debounceMs}
      dataTestId={`total-form-field-${name}`}
    />
  );
}
