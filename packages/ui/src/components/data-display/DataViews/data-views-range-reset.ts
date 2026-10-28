'use client';

import { useEffect, useRef, useState } from 'react';

import type { RangeValue } from './data-views-range-types';

/** One string per range CONTENT: `{}` is rebuilt on every render upstream. */
const rangeKeyOf = (range: RangeValue): string => `${range.min ?? ''}|${range.max ?? ''}`;

/**
 * Remounts the two bound fields when the range is moved from OUTSIDE them — a
 * "Limpar", a preset, a saved view — and never for the fields' own writes.
 *
 * A field keeps a day it refuses (`31/02/2026`) on screen until the APPLIED
 * bound moves. When a clear empties the other bound, or a bound that was open
 * already, this field's bound does not move, so without a remount the refused
 * day would sit red under a filter that had just been cleared (FUT-4144).
 * Remounting only for outside writes keeps the caret where it is while typing.
 */
export function useOutsideResetKey(value: RangeValue): { key: number; emitted: (next: RangeValue) => RangeValue } {
  const [key, setKey] = useState(0);
  const lastWritten = useRef(rangeKeyOf(value));
  const current = rangeKeyOf(value);
  useEffect(() => {
    if (current === lastWritten.current) return;
    lastWritten.current = current;
    setKey((n) => n + 1);
  }, [current]);
  const emitted = (next: RangeValue) => {
    lastWritten.current = rangeKeyOf(next);
    return next;
  };
  return { key, emitted };
}
