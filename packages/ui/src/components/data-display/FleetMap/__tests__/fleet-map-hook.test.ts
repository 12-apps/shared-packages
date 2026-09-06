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

  it('survives a roster RE-SORT of the same coordinates', () => {
    // The case the first test misses, and the one that actually happens.
    // `rosterOrder` sorts on `staleSeconds`, which moves every poll, and
    // `mapCentre` sums over that re-sorted array. Floating-point addition is
    // not associative, so the same riders in a different order can produce a
    // centroid differing in its last bit.
    //
    // These three coordinates are a MEASURED reproducer, not decoration: the
    // rotation below is one of the ~17% of three-rider fleets where the sum
    // genuinely differs, and with the rounding removed this case fails while
    // every other test here still passes. Two units could never catch it —
    // float addition is commutative, so it takes three terms to break.
    const ROTATES = [
      { id: 'a', label: 'A', latitude: -23.524627, longitude: -46.63734 },
      { id: 'b', label: 'B', latitude: -23.539741, longitude: -46.531497 },
      { id: 'c', label: 'C', latitude: -23.609255, longitude: -46.534321 },
    ];
    const withStaleness = (seconds: readonly number[]): FleetUnit[] =>
      ROTATES.map((unit, index) => ({ ...unit, staleSeconds: seconds[index] as number }));

    const { result, rerender } = renderHook(
      ({ units }) => useFleetMap(units, undefined, undefined),
      // Ranked a, b, c.
      { initialProps: { units: withStaleness([1, 2, 3]) } },
    );

    const first = result.current.centre;
    // Same coordinates, ranked c, a, b — nobody has moved.
    rerender({ units: withStaleness([2, 3, 1]) });

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

  it('clears when a CONTROLLED caller passes undefined', () => {
    // `useState<string>()` is the natural shape for a caller, so a controlled
    // board is handed `undefined` on every reset. It must mean "nobody is
    // selected" rather than "take the selection back", or clearing the caller's
    // own state would leave a row highlighted.
    const { result, rerender } = renderHook(
      ({ selectedId }: { selectedId: string | null | undefined }) =>
        useFleetMap(poll(), selectedId, undefined),
      { initialProps: { selectedId: 'ana' as string | null | undefined } },
    );

    expect(result.current.active).toBe('ana');
    rerender({ selectedId: undefined });

    expect(result.current.active).toBeNull();
  });

  it('does not switch modes mid-life when the caller writes a value back', () => {
    // The silent flip this latch exists to stop: an uncontrolled board whose
    // `onSelect` feeds the caller's state would otherwise become controlled on
    // the first click, and un-become it on the first clear — resurrecting
    // whatever was selected before the hand-off.
    const { result, rerender } = renderHook(
      ({ selectedId }: { selectedId: string | null | undefined }) =>
        useFleetMap(poll(), selectedId, undefined),
      { initialProps: { selectedId: undefined as string | null | undefined } },
    );

    act(() => result.current.select('bruno'));
    expect(result.current.active).toBe('bruno');

    // A late `selectedId` is ignored, the way a late `value` is on an input.
    rerender({ selectedId: 'ana' });
    expect(result.current.active).toBe('bruno');
  });

  it('treats an explicit null as controlled, not as absent', () => {
    const { result } = renderHook(() => useFleetMap(poll(), null, undefined));

    act(() => result.current.select('bruno'));

    expect(result.current.active).toBeNull();
  });
});
