import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RegionMap } from '../RegionMap';
import { regionMapView } from '../RegionMap.view';
import type { RegionMapLayer } from '../RegionMap.types';
import {
  REGION_MAP_AREAS,
  REGION_MAP_CENTER,
  REGION_MAP_COPY,
  REGION_MAP_WITH_CONTEXT,
  REGION_MAP_WITH_EXCLUSIONS,
} from '../RegionMap.fixtures';

/**
 * The behaviours CI runs (`test-storybook` is not in this repo's CI, see
 * FleetMap's guards), in jsdom: what is drawn, what a tap reports, and the
 * list a keyboard and a screen reader use.
 */

const MINASCAIXA = '3106200484';
const VENDA_NOVA = '3106200367';
const CONJUNTO_MINASCAIXA = '3106200471';

/** Every rendered test id with this prefix — an absence read in one call. */
function testIdsStartingWith(prefix: string): string[] {
  return Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`)).map(
    (element) => element.getAttribute('data-testid') ?? '',
  );
}

function renderMap(overrides: Partial<React.ComponentProps<typeof RegionMap>> = {}) {
  const onToggle = vi.fn();
  render(
    <RegionMap
      regions={REGION_MAP_WITH_EXCLUSIONS}
      center={REGION_MAP_CENTER}
      circles={[{ radiusMetres: 3000 }]}
      copy={REGION_MAP_COPY}
      onToggle={onToggle}
      dataTestId="map"
      {...overrides}
    />,
  );
  return { onToggle };
}

describe('the drawing', () => {
  it('is one named image with an area per region, the centre and the legend', () => {
    renderMap();

    expect(screen.getByRole('img', { name: REGION_MAP_COPY.mapLabel })).toBeInTheDocument();
    for (const area of REGION_MAP_AREAS) {
      expect(screen.getByTestId(`map-area-${area.id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('map-center')).toBeInTheDocument();
    expect(screen.getByTestId('map-legend')).toHaveTextContent('Not delivered to');
    expect(screen.getByTestId('map-legend')).toHaveTextContent('3 km radius');
  });

  it('hatches AND names every excluded area, and only those', () => {
    renderMap();

    expect(screen.getByTestId(`map-excluded-${MINASCAIXA}`)).toBeInTheDocument();
    expect(screen.getByTestId(`map-label-${MINASCAIXA}`)).toHaveTextContent('Minascaixa');
    // Two of the fixture's ten are excluded: exactly two hatches, two names.
    expect(testIdsStartingWith('map-excluded-')).toEqual(
      expect.arrayContaining([`map-excluded-${MINASCAIXA}`]),
    );
    expect(testIdsStartingWith('map-excluded-')).toHaveLength(2);
    expect(testIdsStartingWith('map-label-')).toHaveLength(2);
    expect(testIdsStartingWith('map-label-')).not.toContain(`map-label-${VENDA_NOVA}`);
  });

  it('outlines and names every highlighted area — a search shows several hits', () => {
    renderMap({ highlightedIds: [VENDA_NOVA, CONJUNTO_MINASCAIXA] });

    expect(screen.getByTestId(`map-highlight-${VENDA_NOVA}`)).toBeInTheDocument();
    expect(screen.getByTestId(`map-highlight-${CONJUNTO_MINASCAIXA}`)).toBeInTheDocument();
    expect(screen.getByTestId(`map-label-${VENDA_NOVA}`)).toHaveTextContent('Venda Nova');
    expect(testIdsStartingWith('map-highlight-')).toHaveLength(2);
  });

  it('lays labels out in priority order: highlighted first, then excluded', () => {
    renderMap({ highlightedIds: [VENDA_NOVA] });

    const order = Array.from(document.querySelectorAll('[data-region-label]')).map((label) =>
      label.getAttribute('data-testid'),
    );
    expect(order[0]).toBe(`map-label-${VENDA_NOVA}`);
    expect(order).toHaveLength(3);
  });

  it('draws nothing at all with no centre and no areas', () => {
    const { container } = render(
      <RegionMap regions={[]} center={null} copy={REGION_MAP_COPY} dataTestId="map" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('centres on the areas when it has no centre of its own, without a dot', () => {
    renderMap({ center: null, circles: [] });

    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(testIdsStartingWith('map-center')).toEqual([]);
  });
});

describe('the reach and the overlay', () => {
  const viewBox = (): string | null => screen.getByRole('img').getAttribute('viewBox');

  it('keeps today\'s view when no reach is given', () => {
    renderMap();

    const [minX, , spanX] = (viewBox() ?? '').split(' ').map(Number);
    expect(minX).toBeCloseTo(-3360);
    expect(spanX).toBeCloseTo(6720);
  });

  it('widens the view to a reach past the largest circle, as regionMapView says', () => {
    renderMap({ reach: { radiusMetres: 4000 } });

    const view = regionMapView({
      regions: REGION_MAP_WITH_EXCLUSIONS,
      center: REGION_MAP_CENTER,
      circles: [{ radiusMetres: 3000 }],
      reach: { radiusMetres: 4000 },
    });
    expect(view?.spanX).toBeCloseTo(8960);
    expect(viewBox()).toBe(`${view?.minX} ${view?.minY} ${view?.spanX} ${view?.spanY}`);
  });

  it('draws the host layer inside the SVG, tap-transparent, with the map\'s view and projection', () => {
    const overlay = vi.fn((_layer: RegionMapLayer): React.ReactNode => <circle r={100} data-testid="host-circle" />);
    const { onToggle } = renderMap({ overlay });

    const group = screen.getByTestId('map-overlay');
    expect(screen.getByRole('img').contains(group)).toBe(true);
    expect(group).toHaveAttribute('pointer-events', 'none');
    expect(group).toContainElement(screen.getByTestId('host-circle'));
    const seen = overlay.mock.calls.at(-1)?.[0];
    const view = seen?.view;
    expect(`${view?.minX} ${view?.minY} ${view?.spanX} ${view?.spanY}`).toBe(viewBox());
    const origin = seen?.projection.project([REGION_MAP_CENTER.latitude, REGION_MAP_CENTER.longitude]);
    expect(origin?.x).toBeCloseTo(0);
    expect(origin?.y).toBeCloseTo(0);

    // The areas beneath still take the tap.
    fireEvent.click(screen.getByTestId(`map-area-${VENDA_NOVA}`));
    expect(onToggle).toHaveBeenCalledWith(VENDA_NOVA);
  });

  it('renders no layer without an overlay', () => {
    renderMap();

    expect(testIdsStartingWith('map-overlay')).toEqual([]);
  });
});

describe('a tap', () => {
  it('on an area reports its id', () => {
    const { onToggle } = renderMap();

    fireEvent.click(screen.getByTestId(`map-area-${VENDA_NOVA}`));

    expect(onToggle).toHaveBeenCalledWith(VENDA_NOVA);
  });

  it('reports nothing on a read-only map', () => {
    render(
      <RegionMap
        regions={REGION_MAP_WITH_EXCLUSIONS}
        center={REGION_MAP_CENTER}
        copy={REGION_MAP_COPY}
        listMode="shown"
        dataTestId="map"
      />,
    );

    expect(screen.getByTestId(`map-row-${MINASCAIXA}`)).not.toHaveAttribute('aria-pressed');
    // No row is a button: the read-only list is text, not controls.
    expect(document.querySelectorAll('button, [role="button"]')).toHaveLength(0);
  });
});

describe('the list', () => {
  it('is behind one button by default, which names how many areas it holds', () => {
    renderMap();

    const toggle = screen.getByTestId('map-list-toggle');
    expect(toggle).toHaveTextContent('See the 10 neighbourhoods as a list');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(testIdsStartingWith('map-list')).toEqual(['map-list-toggle']);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide the list');
    expect(screen.getByRole('group', { name: REGION_MAP_COPY.listLabel })).toBeInTheDocument();
  });

  it('marks each area pressed or not, and a press reports it', () => {
    const { onToggle } = renderMap({ listMode: 'shown' });

    expect(screen.getByTestId(`map-row-${MINASCAIXA}`)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`map-row-${VENDA_NOVA}`)).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId(`map-row-${MINASCAIXA}`));

    expect(onToggle).toHaveBeenCalledWith(MINASCAIXA);
  });

  it('shows each row its detail', () => {
    renderMap({
      listMode: 'shown',
      regions: REGION_MAP_AREAS.map((area) => ({ ...area, detail: 'near' })),
    });

    expect(screen.getByTestId(`map-row-${VENDA_NOVA}`)).toHaveTextContent('Venda Novanear');
  });

  it('leaves outside areas off the list, and counts only what it lists', () => {
    renderMap({ regions: REGION_MAP_WITH_CONTEXT });

    expect(screen.getByTestId('map-list-toggle')).toHaveTextContent('See the 7 neighbourhoods as a list');
    fireEvent.click(screen.getByTestId('map-list-toggle'));
    expect(testIdsStartingWith('map-row-')).toHaveLength(7);
    // Still drawn on the map, faded.
    expect(testIdsStartingWith('map-area-')).toHaveLength(10);
  });

  it('lists an outside area when told to, with its state read out', () => {
    renderMap({
      regions: REGION_MAP_WITH_CONTEXT.map((area) => ({ ...area, listed: true })),
      listMode: 'shown',
    });

    expect(testIdsStartingWith('map-row-')).toHaveLength(10);
    expect(screen.getByRole('button', { name: /^Mantiqueira\s+outside the radius$/u })).toBeInTheDocument();
  });

  it('reads an excluded row as excluded, not only pressed', () => {
    renderMap({ listMode: 'shown' });

    expect(screen.getByRole('button', { name: /^Minascaixa\s+not delivered to$/u })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sorts by name when asked', () => {
    renderMap({ listMode: 'shown', listSort: 'name' });

    const names = testIdsStartingWith('map-row-').map((id) => screen.getByTestId(id).textContent ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names[0]).toMatch(/^Ceu Azul/u);
  });

  it('is not rendered at all when the host offers its own', () => {
    renderMap({ listMode: 'none' });

    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
    expect(testIdsStartingWith('map-list')).toEqual([]);
  });
});
