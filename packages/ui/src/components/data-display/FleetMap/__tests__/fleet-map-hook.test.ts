import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFleetMap } from '../FleetMap.hooks';
import type { FleetUnit } from '../FleetMap.types';

/**
 * The two decisions in `useFleetMap` that the DOM cannot show.
 *
 * A story proves what a user sees; neither of these is visible in a snapshot of
 * the markup. `centre`'s IDENTITY has no rendering at all, and the difference
 * between a controlled and an uncontrolled selection only shows up across two
 * renders with different props.
 */

/** A fresh array of equal units, the way a poll delivers one. */
function poll(staleSeconds = 10): FleetUnit[] {
  return [
    { id: 'ana', label: 'Ana', latitude: -23.55, longitude: -46.63, staleSeconds },
    { id: 'bruno', label: 'Bruno', latitude: -23.56, longitude: -46.64, staleSeconds: staleSeconds + 5 },
  ];
}

describe('centre identity', () => {
  it('is STABLE across a poll that did not move anybody', () => {
    // `MapPreview` re-centres from an effect keyed on `center`'s identity, and
    // `mapCentre` builds a fresh literal every call. Handing it a new object
    // per poll threw away a pan the dispatcher had just made, on a timer.
    const { result, rerender } = renderHook(
      ({ units }) => useFleetMap(units, undefined, undefined),
      { initialProps: { units: poll() } },
    );

    const first = result.current.centre;
    rerender({ units: poll() });

    expect(result.current.centre).toBe(first);
  });

  it('is a NEW object once a unit actually moves', () => {
    const { result, rerender } = renderHook(
      ({ units }) => useFleetMap(units, undefined, undefined),
      { initialProps: { units: poll() } },
    );

    const first = result.current.centre;
    const moved = poll();
    moved[0] = { ...moved[0], latitude: -23.6 } as FleetUnit;
    rerender({ units: moved });

    expect(result.current.centre).not.toBe(first);
    expect(result.current.centre?.lat).not.toBe(first?.lat);
  });
});

describe('selection ownership', () => {
  it('keeps its own when the caller passes no selectedId', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useFleetMap(poll(), undefined, onSelect));

    expect(result.current.active).toBeNull();
    act(() => result.current.select('bruno'));

    expect(result.current.active).toBe('bruno');
    // Still reported, so a consumer can observe a selection it does not own.
    expect(onSelect).toHaveBeenCalledWith('bruno');
  });

  it('defers to the caller when one IS passed, and never moves on its own', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useFleetMap(poll(), 'ana', onSelect));

    act(() => result.current.select('bruno'));

    // `null` is a caller selecting nobody, not an absent prop, so both are
    // controlled — the hook must not quietly take over either.
    expect(result.current.active).toBe('ana');
    expect(onSelect).toHaveBeenCalledWith('bruno');
  });

  it('treats an explicit null as controlled, not as absent', () => {
    const { result } = renderHook(() => useFleetMap(poll(), null, undefined));

    act(() => result.current.select('bruno'));

    expect(result.current.active).toBeNull();
  });
});
