/**
 * The selection model (FUT-942).
 *
 * What these pin is the property the whole thing exists for: **the rows a bulk
 * action receives are the rows whose checkboxes are ticked**, including the
 * ones the current page no longer renders.
 *
 * It is worth testing here rather than through a rendered grid because the bug
 * it replaces was invisible at every layer above: `selectedIds` was right, the
 * checkboxes were right, and only `selectedRows` — the thing a bulk action
 * actually gets — quietly narrowed to one page. A screen-level test would have
 * had to page and then count writes to see it.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSelection } from '../data-views-selection';

interface Row {
  id: string;
  name: string;
}

const PAGE_1: Row[] = [
  { id: 'a', name: 'Coca 2L' },
  { id: 'b', name: 'Pão de queijo' },
];
const PAGE_2: Row[] = [
  { id: 'c', name: 'Guaraná' },
  { id: 'd', name: 'Água' },
];

const getRowId = (row: Row): string => row.id;

/** The hook over a page that the test can swap, the way paging does. */
function renderSelection(initial: Row[], rememberOffPage: boolean) {
  return renderHook(
    ({ rows }: { rows: Row[] }) => useSelection(rows, getRowId, { rememberOffPage }),
    { initialProps: { rows: initial } },
  );
}

const ids = (rows: Row[]): string[] => rows.map((row) => row.id);

describe('server mode — a selection outlives the page that made it', () => {
  it('keeps the rows ticked on an earlier page', () => {
    const { result, rerender } = renderSelection(PAGE_1, true);
    act(() => result.current.toggleId('a'));

    rerender({ rows: PAGE_2 });
    act(() => result.current.toggleId('c'));

    // The bug: this used to be ['c'] while two checkboxes were ticked.
    expect(ids(result.current.selectedRows).sort()).toEqual(['a', 'c']);
  });

  it('counts them, which is what the bulk menu shows', () => {
    const { result, rerender } = renderSelection(PAGE_1, true);
    act(() => result.current.setSelectedIds(new Set(['a', 'b'])));

    rerender({ rows: PAGE_2 });
    act(() => result.current.toggleId('c'));

    expect(result.current.selectedRows).toHaveLength(3);
  });

  it('lists the CURRENT page first, in the page’s own order', () => {
    // Unchanged from before the fix for everything on screen — the remembered
    // rows are a tail, so the familiar case reads exactly as it did.
    const { result, rerender } = renderSelection(PAGE_1, true);
    act(() => result.current.toggleId('a'));
    rerender({ rows: PAGE_2 });

    act(() => result.current.setSelectedIds(new Set(['a', 'c', 'd'])));

    expect(ids(result.current.selectedRows)).toEqual(['c', 'd', 'a']);
  });

  it('forgets a row as soon as it is unticked, even off-page', () => {
    const { result, rerender } = renderSelection(PAGE_1, true);
    act(() => result.current.toggleId('a'));
    rerender({ rows: PAGE_2 });

    act(() => result.current.toggleId('a'));

    expect(result.current.selectedRows).toEqual([]);
  });

  it('forgets everything on clear', () => {
    const { result, rerender } = renderSelection(PAGE_1, true);
    act(() => result.current.setSelectedIds(new Set(['a', 'b'])));
    rerender({ rows: PAGE_2 });

    act(() => result.current.clearSelection());

    expect(result.current.selectedRows).toEqual([]);
  });

  it('prefers the row the CURRENT page holds over the remembered one', () => {
    // A row edited elsewhere and re-fetched must not be acted on through a
    // stale snapshot: the remembered copy is a fallback, never a source.
    const { result, rerender } = renderSelection(PAGE_1, true);
    act(() => result.current.toggleId('a'));
    rerender({ rows: PAGE_2 });

    rerender({ rows: [{ id: 'a', name: 'Coca 2L (novo nome)' }] });

    expect(result.current.selectedRows).toEqual([{ id: 'a', name: 'Coca 2L (novo nome)' }]);
  });
});

describe('client mode — the selection narrows with the filter', () => {
  it('drops a row the filter no longer matches', () => {
    // Deliberately NOT remembered: in client mode `matched` is the whole
    // filtered result, so an off-page row does not exist — and a bulk action
    // reaching rows the operator has just filtered away would be the opposite
    // of the bug above.
    const { result, rerender } = renderSelection(PAGE_1, false);
    act(() => result.current.setSelectedIds(new Set(['a', 'b'])));

    rerender({ rows: [PAGE_1[0] as Row] });

    expect(ids(result.current.selectedRows)).toEqual(['a']);
  });
});

describe('the parts that did not change', () => {
  it('toggles one id at a time', () => {
    const { result } = renderSelection(PAGE_1, true);

    act(() => result.current.toggleId('a'));
    act(() => result.current.toggleId('b'));

    expect([...result.current.selectedIds].sort()).toEqual(['a', 'b']);
  });

  it('selects everything the current page holds', () => {
    const { result } = renderSelection(PAGE_1, true);

    act(() => result.current.selectAll());

    expect([...result.current.selectedIds].sort()).toEqual(['a', 'b']);
  });
});
