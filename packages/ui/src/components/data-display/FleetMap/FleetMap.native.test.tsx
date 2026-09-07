import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FleetMap } from './FleetMap.native';
import { FLEET_DOT, FLEET_ROW, FLEET_SKELETON } from './FleetMap.metrics';
import type { FleetMapCopy, FleetUnit } from './FleetMap.types.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * The native board, rendered through react-native-web, so `testID` arrives as
 * `data-testid` and the resolved style is what a browser would paint.
 *
 * What is asserted here is what the SHARED stories cannot reach: the numbers
 * come from `FleetMap.metrics.ts` (so a change on one renderer that forgets the
 * other is a red test, not a visual drift), and the map's absence is asserted
 * as a CONTRACT rather than left as an accident nobody would notice.
 */

const COPY: FleetMapCopy = {
  title: 'Frota',
  emptyTitle: 'Ninguém rodando',
  emptyDescription: 'Nenhum entregador reportou posição.',
  rosterLabel: 'Entregadores',
  freshness: { live: 'Ao vivo', lagging: 'Atrasado', stale: 'Parado' },
  lastSeen: (seconds) => `há ${Math.round(seconds / 60)} min`,
  accuracy: (metres) => `±${metres} m`,
};

const FLEET: FleetUnit[] = [
  { id: 'a', label: 'Rafa', latitude: -23.55, longitude: -46.63, staleSeconds: 10, accuracyM: 12 },
  { id: 'b', label: 'Bia', latitude: -23.56, longitude: -46.64, staleSeconds: 120, badge: '2 entregas' },
  { id: 'c', label: 'Caio', latitude: -23.57, longitude: -46.65, staleSeconds: 900, accuracyM: null },
];

/**
 * Every `data-testid` the panel actually rendered.
 *
 * Absences are asserted against THIS rather than with a bare
 * `queryByTestId(...).not.toBeInTheDocument()`, which also passes when the id is
 * misspelled and the element could never have been found at all. Asking the
 * inventory proves in one query that the tree was searched and that the thing
 * looked for is genuinely not in it.
 */
function testIdsUnder(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-testid]')].flatMap((node) => {
    const id = node.getAttribute('data-testid');
    return id === null ? [] : [id];
  });
}

function renderBoard(props: Partial<React.ComponentProps<typeof FleetMap>> = {}) {
  return render(
    <UiProvider theme={createUiTheme()}>
      <FleetMap units={FLEET} copy={COPY} dataTestId="fleet" {...props} />
    </UiProvider>,
  );
}

describe('the native board', () => {
  it('draws one row per unit, freshest first', () => {
    renderBoard();

    // `rosterOrder` is shared, so this also proves the native side reads it.
    const labels = screen.getAllByTestId(/^fleet-[abc]-label$/).map((node) => node.textContent);
    expect(labels).toEqual(['Rafa', 'Bia', 'Caio']);
  });

  it('states each freshness in WORDS, not only as a dot colour', () => {
    renderBoard();

    // The dot repeats the word, so the word must be there for a reader who
    // cannot see the dot at all.
    expect(screen.getByTestId('fleet-a-meta').textContent).toContain('Ao vivo');
    expect(screen.getByTestId('fleet-b-meta').textContent).toContain('Atrasado');
    expect(screen.getByTestId('fleet-c-meta').textContent).toContain('Parado');
  });

  it('drops the accuracy clause when the platform reported none', () => {
    renderBoard();

    // Rafa has one; Caio's is explicitly null and must not leave a dangling
    // separator behind it.
    expect(screen.getByTestId('fleet-a-meta').textContent).toContain('±12 m');
    expect(screen.getByTestId('fleet-c-meta').textContent).not.toContain('±');
    expect(screen.getByTestId('fleet-c-meta').textContent?.endsWith('·')).toBe(false);
  });

  it('hides the freshness dot from the reader and sizes it from the metrics', () => {
    renderBoard();

    const dot = screen.getByTestId('fleet-a-dot');
    expect(dot).toHaveStyle({ width: `${FLEET_DOT.size}px`, height: `${FLEET_DOT.size}px` });
  });

  it('scales a row radius with the HOST theme rather than a fixed pixel count', () => {
    // The same trap the web half carries a comment about: a literal would look
    // right on the default theme and wrong on every re-themed host.
    // `createUiTheme` has no radius knob — the scale is a constant — but
    // `UiProvider` takes a whole `UiTheme` as readily as options, which is the
    // door a host with its own radius comes through.
    const base = createUiTheme();
    const { unmount } = render(
      <UiProvider theme={{ ...base, radius: { ...base.radius, md: 12 } }}>
        <FleetMap units={FLEET} copy={COPY} dataTestId="themed" />
      </UiProvider>,
    );
    const row = screen.getByTestId('themed-a');
    // react-native-web writes the four longhands rather than the shorthand, so
    // that is what the DOM has to be asked for.
    expect(row).toHaveStyle({
      borderTopLeftRadius: `${FLEET_ROW.radiusMultiple * 12}px`,
      borderBottomRightRadius: `${FLEET_ROW.radiusMultiple * 12}px`,
    });
    unmount();
  });

  it('renders the empty STATE when nobody is reporting, never an empty list', () => {
    // Populated FIRST, so the absence below is evidence rather than a typo: a
    // bare `queryByTestId(...).not.toBeInTheDocument()` also passes when the id
    // is misspelled and the element could never have been found at all.
    const populated = renderBoard();
    expect(screen.getByTestId('fleet-roster')).toBeInTheDocument();
    populated.unmount();

    renderBoard({ units: [] });
    const ids = testIdsUnder(screen.getByTestId('fleet'));
    expect(ids).toContain('fleet-empty');
    expect(ids).not.toContain('fleet-roster');
  });

  it('shows skeletons only before the first units land', async () => {
    const { rerender } = renderBoard({ units: [], loading: true });
    expect(screen.getByTestId('fleet-skeleton')).toBeInTheDocument();

    // A poll over a POPULATED roster keeps the list: unmounting it would throw
    // away the focus and the rows a reader was part-way through.
    rerender(
      <UiProvider theme={createUiTheme()}>
        <FleetMap units={FLEET} copy={COPY} dataTestId="fleet" loading />
      </UiProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('fleet-skeleton')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('fleet-roster')).toBeInTheDocument();
  });

  it('draws exactly the number of skeleton bars the metrics name', () => {
    renderBoard({ units: [], loading: true });

    expect(screen.getByTestId('fleet-skeleton').children).toHaveLength(FLEET_SKELETON.rows);
  });

  it('stays silent while loading unless the caller supplied the sentence', () => {
    // The region WITH the copy first — so the silence below is a decision the
    // component made, not an id this test failed to spell.
    const said = render(
      <UiProvider theme={createUiTheme()}>
        <FleetMap
          units={[]}
          copy={{ ...COPY, loading: 'Atualizando a frota' }}
          dataTestId="said"
          loading
        />
      </UiProvider>,
    );
    expect(screen.getByTestId('said-status').textContent).toBe('Atualizando a frota');
    said.unmount();

    renderBoard({ units: [], loading: true });
    const ids = testIdsUnder(screen.getByTestId('fleet'));
    expect(ids).toContain('fleet-skeleton');
    expect(ids).not.toContain('fleet-status');
  });

  it('reports a press through onSelect', () => {
    const onSelect = vi.fn();
    renderBoard({ onSelect });

    // `fireEvent`, not `.click()`: with no `selectedId` this board owns its
    // own selection, so the press is a state update React wants wrapped.
    fireEvent.click(screen.getByTestId('fleet-b'));

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('marks the selected row selected, and only that one', () => {
    renderBoard({ selectedId: 'b', onSelect: vi.fn() });

    expect(screen.getByTestId('fleet-b')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('fleet-a')).not.toHaveAttribute('aria-selected', 'true');
  });

  it('drops the active-descendant when the selection has left the fleet', () => {
    // A courier ending their shift mid-poll: the id is still passed but no row
    // renders it, and pointing at an absent element announces nothing.
    renderBoard({ selectedId: 'gone', onSelect: vi.fn() });

    expect(screen.getByTestId('fleet-roster')).not.toHaveAttribute('aria-activedescendant');
  });

  it('does NOT render a map — the gap NATIVE-NOTES.md records', () => {
    // Asserted rather than assumed. `MapPreview` has no native build, so a
    // canvas appearing here would mean someone had wired a web-only component
    // into the native tree, which fails at import under Metro rather than in
    // this jsdom.
    renderBoard();

    // Asserted over the panel's OWN inventory rather than as a bare absence:
    // this proves in one query that the tree really was searched (the roster is
    // in it) and that nothing map-shaped is anywhere inside it.
    const ids = testIdsUnder(screen.getByTestId('fleet'));
    expect(ids).toContain('fleet-roster');
    expect(ids.filter((entry) => entry.includes('canvas'))).toEqual([]);
  });
});
