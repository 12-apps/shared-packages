// @vitest-environment jsdom
/**
 * The three properties the module's header calls load-bearing, each as a case:
 * the write MERGES, the hooks RE-KEY, and a `null` key persists nothing.
 *
 * The re-key cases are the ones with a history. A shell's `storeKey` changes
 * for two reasons — a tenant switcher swapping the tenant in place, and a
 * session resolving, which turns a `null` key into a real one — and a hook that
 * reads its stored entry once serves the wrong key in both. The second was live
 * in a shipped console: its copy of these hooks had dropped the re-key on the
 * grounds that its key never changed, which is true of the tenant and false of
 * the session.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sidebarStorageKey, useCollapsedSections, useSidebarRail } from '../sidebar-state';

const KEY_ACME = 'shell-sidebar:acme:ana@example.com';
const KEY_BETA = 'shell-sidebar:beta:ana@example.com';

function seed(key: string, state: { collapsed?: string[]; rail?: boolean }): void {
  window.localStorage.setItem(key, JSON.stringify(state));
}

function stored(key: string): { collapsed?: string[]; rail?: boolean } {
  return JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
    collapsed?: string[];
    rail?: boolean;
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('sidebarStorageKey', () => {
  it('colon-joins the prefix and every segment', () => {
    expect(sidebarStorageKey('admin-sidebar', 'acme', 'ana@example.com')).toBe(
      'admin-sidebar:acme:ana@example.com',
    );
    expect(sidebarStorageKey('platform-sidebar', 'ana@example.com')).toBe(
      'platform-sidebar:ana@example.com',
    );
  });

  it('is null when a segment is empty, so no two visitors share one entry', () => {
    expect(sidebarStorageKey('admin-sidebar', 'acme', '')).toBeNull();
    expect(sidebarStorageKey('admin-sidebar', '', 'ana@example.com')).toBeNull();
    expect(sidebarStorageKey('admin-sidebar')).toBeNull();
  });
});

describe('useCollapsedSections', () => {
  it('reads the stored sections, and stores the exception rather than the state', () => {
    seed(KEY_ACME, { collapsed: ['catalog'] });

    const { result } = renderHook(() => useCollapsedSections(KEY_ACME));

    expect([...result.current[0]]).toEqual(['catalog']);
    // A section nobody has touched is absent from the entry, i.e. expanded.
    expect(result.current[0].has('operations')).toBe(false);
  });

  it('toggles a section on and back off', () => {
    const { result } = renderHook(() => useCollapsedSections(KEY_ACME));

    act(() => result.current[1]('catalog'));
    expect(stored(KEY_ACME).collapsed).toEqual(['catalog']);

    act(() => result.current[1]('catalog'));
    expect(stored(KEY_ACME).collapsed).toEqual([]);
  });

  it('re-reads the destination entry on a storeKey switch', () => {
    seed(KEY_ACME, { collapsed: ['catalog'] });
    seed(KEY_BETA, { collapsed: ['team'] });

    const { result, rerender } = renderHook(({ key }) => useCollapsedSections(key), {
      initialProps: { key: KEY_ACME },
    });
    expect([...result.current[0]]).toEqual(['catalog']);

    rerender({ key: KEY_BETA });
    expect([...result.current[0]]).toEqual(['team']);
  });

  it('reads the stored entry once a null key resolves to a real one', () => {
    seed(KEY_ACME, { collapsed: ['catalog'] });

    const { result, rerender } = renderHook(({ key }) => useCollapsedSections(key), {
      initialProps: { key: null as string | null },
    });
    expect([...result.current[0]]).toEqual([]);

    rerender({ key: KEY_ACME });
    expect([...result.current[0]]).toEqual(['catalog']);
  });

  it('writes a post-switch toggle into the destination key only', () => {
    seed(KEY_ACME, { collapsed: ['catalog'] });

    const { result, rerender } = renderHook(({ key }) => useCollapsedSections(key), {
      initialProps: { key: KEY_ACME },
    });
    rerender({ key: KEY_BETA });
    act(() => result.current[1]('operations'));

    expect(stored(KEY_BETA).collapsed).toEqual(['operations']);
    // The source key's entry is untouched by the destination's toggle.
    expect(stored(KEY_ACME).collapsed).toEqual(['catalog']);
  });

  it('persists nothing under a null key', () => {
    const { result } = renderHook(() => useCollapsedSections(null));

    act(() => result.current[1]('catalog'));

    expect([...result.current[0]]).toEqual(['catalog']);
    expect(window.localStorage.length).toBe(0);
  });
});

describe('useSidebarRail', () => {
  it('defaults to expanded and toggles', () => {
    const { result } = renderHook(() => useSidebarRail(KEY_ACME));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(true);
    expect(stored(KEY_ACME).rail).toBe(true);
  });

  it('re-reads the destination entry on a storeKey switch', () => {
    seed(KEY_ACME, { rail: true });
    seed(KEY_BETA, { rail: false });

    const { result, rerender } = renderHook(({ key }) => useSidebarRail(key), {
      initialProps: { key: KEY_ACME },
    });
    expect(result.current[0]).toBe(true);

    rerender({ key: KEY_BETA });
    expect(result.current[0]).toBe(false);
  });

  it('writes a post-switch toggle into the destination key only', () => {
    seed(KEY_ACME, { rail: true });

    const { result, rerender } = renderHook(({ key }) => useSidebarRail(key), {
      initialProps: { key: KEY_ACME },
    });
    rerender({ key: KEY_BETA });
    act(() => result.current[1]());

    expect(stored(KEY_BETA).rail).toBe(true);
    expect(stored(KEY_ACME).rail).toBe(true);
  });
});

describe('the shared entry', () => {
  it('keeps the half it is not writing', () => {
    seed(KEY_ACME, { rail: true });

    const sections = renderHook(() => useCollapsedSections(KEY_ACME));
    act(() => sections.result.current[1]('catalog'));

    // A rail preference written before this nav had sections survives the
    // section toggle — this is the merge, and a replacing write would drop it.
    expect(stored(KEY_ACME)).toEqual({ rail: true, collapsed: ['catalog'] });

    const rail = renderHook(() => useSidebarRail(KEY_ACME));
    act(() => rail.result.current[1]());

    expect(stored(KEY_ACME)).toEqual({ rail: false, collapsed: ['catalog'] });
  });
});

describe('a corrupt or absent entry', () => {
  it.each([
    ['absent', undefined],
    ['not JSON', '{oops'],
    ['not an object', '"a string"'],
    ['a wrongly-typed collapsed', '{"collapsed":"catalog","rail":"yes"}'],
    ['non-string members', '{"collapsed":["catalog",7,null]}'],
  ])('reads %s as no preference', (_label, raw) => {
    if (raw !== undefined) window.localStorage.setItem(KEY_ACME, raw);

    const sections = renderHook(() => useCollapsedSections(KEY_ACME));
    const rail = renderHook(() => useSidebarRail(KEY_ACME));

    expect([...sections.result.current[0]]).toEqual(
      raw === '{"collapsed":["catalog",7,null]}' ? ['catalog'] : [],
    );
    expect(rail.result.current[0]).toBe(false);
  });

  it('survives a storage that throws on write', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    const { result } = renderHook(() => useSidebarRail(KEY_ACME));
    act(() => result.current[1]());

    // The nav still reflects the click; only the persistence was lost.
    expect(result.current[0]).toBe(true);
    setItem.mockRestore();
  });
});
