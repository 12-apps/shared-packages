import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegionMap } from '../RegionMap';
import { projectionAt } from '../RegionMap.helpers';
import { REGION_MAP_AREAS, REGION_MAP_CENTER, REGION_MAP_COPY } from '../RegionMap.fixtures';
import { latLngAt, scaleMetres } from '../RegionMapPin';
import type { RegionMapCenter, RegionMapPin } from '../RegionMap.types';

/**
 * The movable centre (`pin`, `ghost`, `dots`, `copy.scale`): a pin the viewer
 * drags or nudges with the arrow keys while the view stays on `center`, the
 * circles that follow it, the ring left where they stood, and the scale bar.
 */

const ARIA = 'Store pin. Drag it, or use the arrow keys, to move it';

/** `metres` east and north of the centre. */
function offset(east: number, north: number): RegionMapCenter {
  return latLngAt(REGION_MAP_CENTER, { x: east, y: -north });
}

function renderPin(pin: Partial<RegionMapPin> = {}, extra: Partial<React.ComponentProps<typeof RegionMap>> = {}) {
  const onDrop = vi.fn();
  const onMove = vi.fn();
  const view = render(
    <RegionMap
      regions={REGION_MAP_AREAS}
      center={REGION_MAP_CENTER}
      circles={[{ radiusMetres: 1500 }, { radiusMetres: 3000 }]}
      copy={{ ...REGION_MAP_COPY, scale: (metres) => (metres >= 1000 ? `${metres / 1000} km` : `${metres} m`) }}
      listMode="none"
      dataTestId="map"
      pin={{ at: REGION_MAP_CENTER, label: 'Store', ariaLabel: ARIA, onDrop, onMove, ...pin }}
      {...extra}
    />,
  );
  return { onDrop, onMove, ...view };
}

/** A pointer event jsdom can carry: a MouseEvent of the pointer type, with its id. */
function pointer(target: Element, type: string, init: { pointerId: number; clientX: number; clientY: number }): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  fireEvent(target, event);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a draggable centre', () => {
  it('is a focusable button with its name and label, in place of the centre dot', () => {
    renderPin();

    const pin = screen.getByRole('button', { name: ARIA });
    expect(pin).toHaveAttribute('tabindex', '0');
    expect(pin).toHaveTextContent('Store');
    expect(pin).toHaveAttribute('data-region-pin');
    expect(screen.queryAllByTestId('map-center')).toHaveLength(0);
  });

  it('an arrow key moves it 50 m, as a move and a drop', () => {
    const { onDrop, onMove } = renderPin();

    fireEvent.keyDown(screen.getByRole('button', { name: ARIA }), { key: 'ArrowUp' });

    const at = onDrop.mock.calls[0]![0] as RegionMapCenter;
    const plane = projectionAt(REGION_MAP_CENTER).project([at.latitude, at.longitude]);
    expect(plane.x).toBeCloseTo(0, 6);
    expect(-plane.y).toBeCloseTo(50, 6);
    expect(onMove).toHaveBeenCalledWith(at);
  });

  it("the host's step wins, and other keys do nothing", () => {
    const { onDrop } = renderPin({ stepMetres: 5 });
    const pin = screen.getByRole('button', { name: ARIA });

    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(onDrop).not.toHaveBeenCalled();
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    const at = onDrop.mock.calls[0]![0] as RegionMapCenter;
    expect(projectionAt(REGION_MAP_CENTER).project([at.latitude, at.longitude]).x).toBeCloseTo(5, 6);
  });

  it('held while disabled: no tab stop, no move', () => {
    const { onDrop } = renderPin({ disabled: true });
    const pin = screen.getByRole('button', { name: ARIA });

    expect(pin).toHaveAttribute('tabindex', '-1');
    expect(pin).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(pin, { key: 'ArrowUp' });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('a pointer drag reports where it is over the drawing, and the drop, clamped inside the view', () => {
    const { onDrop, onMove } = renderPin();
    const svg = screen.getByRole('img', { name: REGION_MAP_COPY.mapLabel });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    const pin = screen.getByRole('button', { name: ARIA });

    pointer(pin, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
    pointer(pin, 'pointermove', { pointerId: 1, clientX: 300, clientY: 200 });
    pointer(pin, 'pointerup', { pointerId: 1, clientX: 900, clientY: 200 });

    const moved = onMove.mock.calls[0]![0] as RegionMapCenter;
    expect(moved.longitude).toBeGreaterThan(REGION_MAP_CENTER.longitude);
    const dropped = onDrop.mock.calls[0]![0] as RegionMapCenter;
    // 900 px is past the 400 px drawing: the drop stops inside its east edge.
    const east = projectionAt(REGION_MAP_CENTER).project([dropped.latitude, dropped.longitude]).x;
    const edge = projectionAt(REGION_MAP_CENTER).project([moved.latitude, moved.longitude]).x;
    expect(east).toBeGreaterThan(edge);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('a cancelled drag rests where the last move put it, never at the cancel\'s own 0,0', () => {
    const { onDrop, onMove } = renderPin();
    const svg = screen.getByRole('img', { name: REGION_MAP_COPY.mapLabel });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 400, height: 400, right: 500, bottom: 500, x: 100, y: 100, toJSON: () => ({}) });
    const pin = screen.getByRole('button', { name: ARIA });

    pointer(pin, 'pointerdown', { pointerId: 7, clientX: 300, clientY: 300 });
    pointer(pin, 'pointermove', { pointerId: 7, clientX: 340, clientY: 300 });
    pointer(pin, 'pointercancel', { pointerId: 7, clientX: 0, clientY: 0 });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(onMove.mock.calls.at(-1)![0]);
  });

  it('a drag cancelled before it moved drops nothing', () => {
    const { onDrop } = renderPin();
    const pin = screen.getByRole('button', { name: ARIA });

    pointer(pin, 'pointerdown', { pointerId: 8, clientX: 300, clientY: 300 });
    pointer(pin, 'pointercancel', { pointerId: 8, clientX: 0, clientY: 0 });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('an arrow key stops at the edge of the view, as a drag does', () => {
    const { onDrop } = renderPin({ stepMetres: 1_000_000 });

    fireEvent.keyDown(screen.getByRole('button', { name: ARIA }), { key: 'ArrowRight' });

    const at = onDrop.mock.calls[0]![0] as RegionMapCenter;
    const east = projectionAt(REGION_MAP_CENTER).project([at.latitude, at.longitude]).x;
    // Inside the view (a few km around the centre), nowhere near the 1 000 km asked.
    expect(east).toBeGreaterThan(0);
    expect(east).toBeLessThan(20_000);
  });

  it('a press on the pin never reaches a host listener on the drawing', () => {
    renderPin();
    const host = vi.fn();
    const canvas = screen.getByTestId('map-canvas');
    canvas.addEventListener('pointerdown', host);

    pointer(screen.getByRole('button', { name: ARIA }), 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });

    expect(host).not.toHaveBeenCalled();
  });

  it('draws the circles around the pin, not the centre', () => {
    renderPin({ at: offset(300, 0) });

    const circles = Array.from(document.querySelectorAll('svg circle[stroke-width="2.25"]'));
    expect(circles).toHaveLength(2);
    for (const circle of circles) expect(Number(circle.getAttribute('cx'))).toBeCloseTo(300, 3);
  });
});

describe('the ring where the circles stood, the dots and the scale', () => {
  it('draws the ghost with a pin, and not without one', () => {
    renderPin({ at: offset(300, 0) }, { ghost: { at: REGION_MAP_CENTER, radiusMetres: 3000 } });

    const ghost = screen.getByTestId('map-ghost');
    expect(ghost.querySelector('circle')).toHaveAttribute('r', '3000');
    expect(ghost.querySelector('circle')).toHaveAttribute('stroke-dasharray', '6 5');
  });

  it('draws each dot filled or hollow', () => {
    renderPin({}, { dots: [{ id: 'in', at: offset(100, 100), filled: true }, { id: 'out', at: offset(4000, 0), filled: false }] });

    const dots = Array.from(screen.getByTestId('map-dots').querySelectorAll('circle')).map((dot) => dot.getAttribute('data-filled'));
    expect(dots).toEqual(['true', 'false']);
  });

  it('prints a scale bar only when the copy names one', () => {
    renderPin();
    expect(screen.getByTestId('map-scale')).toHaveTextContent(/^\d+ (km|m)$/);
  });

  it('picks the longest nice length within a quarter of the width', () => {
    expect(scaleMetres({ minX: 0, minY: 0, spanX: 7800, spanY: 7800 })).toBe(1000);
    expect(scaleMetres({ minX: 0, minY: 0, spanX: 560, spanY: 480 })).toBe(100);
    expect(scaleMetres({ minX: 0, minY: 0, spanX: 900, spanY: 900 })).toBe(200);
  });

  it('keeps a map without a pin exactly as before: the centre dot, dashed circles, no scale', () => {
    render(<RegionMap regions={REGION_MAP_AREAS} center={REGION_MAP_CENTER} circles={[{ radiusMetres: 3000 }]} copy={REGION_MAP_COPY} listMode="none" dataTestId="map" />);

    expect(screen.getByTestId('map-center')).toBeInTheDocument();
    expect(screen.queryAllByTestId('map-scale')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: ARIA })).toHaveLength(0);
    expect(document.querySelector('svg circle[stroke-dasharray="7 5"]')).not.toBeNull();
  });
});
