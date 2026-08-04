'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { cepDigits, formatCep, isValidCep } from '@12-apps/forms-core';

import { FormControl, FormLabel, FormMessage } from '../Form';
import { Input } from '../Input';
import type { CepAddress, CepFieldProps, CepLookupStatus } from './CepField.types';

/** What the user is told for each non-idle outcome. */
const STATUS_TEXT: Record<Exclude<CepLookupStatus, 'idle'>, string> = {
  loading: 'Buscando endereço…',
  found: 'Endereço preenchido pelo CEP.',
  notfound: 'CEP não encontrado — preencha o endereço manualmente.',
};

/** Everything {@link useCepLookup} needs, so the hook signature stays flat. */
interface LookupOptions {
  digits: string;
  complete: boolean;
  disabled: boolean;
  debounceMs: number;
  onLookup?: (cep: string) => Promise<CepAddress | null>;
  onResolved?: (address: CepAddress) => void;
  onNotFound?: () => void;
}

/**
 * Debounced, race-safe CEP resolution.
 *
 * Two guards earn their keep here: a monotonic sequence id, bumped
 * synchronously on every new query, so a slow response for a since-edited CEP
 * can never land; and a "last queried" marker, so re-rendering (or the caller
 * re-masking the same value) never re-hits the provider.
 */
function useCepLookup({
  digits,
  complete,
  disabled,
  debounceMs,
  onLookup,
  onResolved,
  onNotFound,
}: LookupOptions): CepLookupStatus {
  const [status, setStatus] = useState<CepLookupStatus>('idle');
  const lastQueriedRef = useRef('');
  const seqRef = useRef(0);
  // Latest callbacks, read at call time — keeps them out of the effect deps so
  // an inline arrow from the caller doesn't re-trigger the lookup every render.
  const lookupRef = useRef(onLookup);
  const resolvedRef = useRef(onResolved);
  const notFoundRef = useRef(onNotFound);
  lookupRef.current = onLookup;
  resolvedRef.current = onResolved;
  notFoundRef.current = onNotFound;

  useEffect(() => {
    if (!complete || disabled || !lookupRef.current) {
      // Editing away from a complete CEP drops any stale status and forgets the
      // last query, so re-typing the same CEP resolves again.
      seqRef.current += 1;
      setStatus('idle');
      lastQueriedRef.current = '';
      return;
    }
    if (lastQueriedRef.current === digits) return;

    const mySeq = (seqRef.current += 1);
    const handle = setTimeout(() => {
      lastQueriedRef.current = digits;
      setStatus('loading');
      void (async () => {
        // A failing lookup is treated exactly like "not found" — the user types
        // the address instead. Never surfaced as a crash. Going through
        // `Promise.resolve().then` rather than calling directly covers the two
        // failure modes an `await … .catch()` misses: a lookup that throws
        // SYNCHRONOUSLY, and one that returns something other than a promise.
        const address = await Promise.resolve()
          .then(() => lookupRef.current?.(digits))
          .catch(() => null);
        if (seqRef.current !== mySeq) return;
        setStatus(address ? 'found' : 'notfound');
        // A miss is reported too, so a caller that filled from a PREVIOUS CEP
        // can undo it rather than leaving that address under this CEP.
        if (address) resolvedRef.current?.(address);
        else notFoundRef.current?.();
      })();
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [digits, complete, disabled, debounceMs]);

  return status;
}

/**
 * The lookup outcome as a live region, so screen readers announce it without
 * stealing focus. Silent while idle, and while the caller is showing its own
 * validation error (which would otherwise stack two messages).
 */
function CepStatus({
  status,
  testId,
  suppressed,
}: {
  status: CepLookupStatus;
  testId: string;
  suppressed: boolean;
}): React.ReactElement {
  const visible = !suppressed && status !== 'idle';
  return (
    <span id={`${testId}-status`} role="status" aria-live="polite">
      {visible && (
        <FormMessage error={status === 'notfound'} dataTestId={`${testId}-${status}`}>
          {STATUS_TEXT[status as Exclude<CepLookupStatus, 'idle'>]}
        </FormMessage>
      )}
    </span>
  );
}

/**
 * A CEP input that fills the rest of the address in.
 *
 * The pattern every Brazilian form has used for twenty years: type eight
 * digits, and logradouro/bairro/cidade/UF arrive on their own. This is the
 * reusable half — masking, validation, debouncing, race-safety and status —
 * with the actual lookup injected via `onLookup`, so the same component serves
 * a supplier form, a store-location form or a delivery checkout without
 * knowing anything about providers or auth.
 *
 * Resolution is best-effort by design. A provider outage, an unknown CEP or a
 * timeout leaves the field exactly as usable as a plain text input — the user
 * types the address themselves. Autofill never blocks.
 *
 * @example
 * ```tsx
 * <CepField
 *   value={cep}
 *   onChange={setCep}
 *   onLookup={(c) => fetch(`/api/…/lookup/cep/${c}`).then((r) => r.json()).then((b) => b.data)}
 *   onResolved={(a) => { setStreet(a.street ?? ''); setCity(a.city ?? ''); }}
 * />
 * ```
 */
export function CepField({
  value,
  onChange,
  onLookup,
  onResolved,
  onNotFound,
  label = 'CEP',
  placeholder = '00000-000',
  error,
  disabled = false,
  debounceMs = 500,
  name = 'postalCode',
  dataTestId,
}: CepFieldProps): React.ReactElement {
  const testId = dataTestId ?? `cep-field-${name}`;

  const status = useCepLookup({
    digits: cepDigits(value),
    complete: isValidCep(value),
    disabled,
    debounceMs,
    onLookup,
    onResolved,
    onNotFound,
  });

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onChange(formatCep(event.target.value)),
    [onChange],
  );

  return (
    <FormControl fullWidth>
      {label && (
        <FormLabel htmlFor={name} error={Boolean(error)}>
          {label}
        </FormLabel>
      )}
      <Input
        id={name}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder={placeholder}
        value={value}
        error={Boolean(error)}
        disabled={disabled}
        loading={status === 'loading'}
        onChange={handleChange}
        data-testid={testId}
        aria-describedby={`${testId}-status`}
        aria-busy={status === 'loading'}
      />
      {error && (
        <FormMessage error dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
      <CepStatus status={status} testId={testId} suppressed={Boolean(error)} />
    </FormControl>
  );
}

export default CepField;
