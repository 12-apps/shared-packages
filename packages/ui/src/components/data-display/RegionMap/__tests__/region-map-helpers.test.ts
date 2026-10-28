import { describe, expect, it } from 'vitest';

import {
  decodePolyline,
  extent,
  planeBounds,
  hitRegion,
  labelPosition,
  planeArea,
  projectionAt,
  ringsContain,
  ringsDistance,
  viewBoxFor,
  type PlanePoint,
} from '../RegionMap.helpers';
import { clampCentre, labelOrder, placeLabels } from '../RegionMap.labels';

/** A square of `side` metres with its corner at (x, y). */
const square = (x: number, y: number, side: number): PlanePoint[] => [
  { x, y },
  { x: x + side, y },
  { x: x + side, y: y + side },
  { x, y: y + side },
];

describe('a point inside rings', () => {
  const withHole = [square(0, 0, 100), square(40, 40, 20)];

  it('is in the polygon and out of its hole, by the even-odd rule', () => {
    expect(ringsContain(withHole, { x: 10, y: 10 })).toBe(true);
    expect(ringsContain(withHole, { x: 50, y: 50 })).toBe(false);
    expect(ringsContain(withHole, { x: 150, y: 50 })).toBe(false);
  });

  it('measures 0 inside and the nearest edge outside', () => {
    expect(ringsDistance(withHole, { x: 10, y: 10 })).toBe(0);
    expect(ringsDistance(withHole, { x: 110, y: 50 })).toBe(10);
    // In the hole, the hole's own edge is nearest.
    expect(ringsDistance(withHole, { x: 50, y: 50 })).toBe(10);
  });
});

/** A hit-test area from its rings, as the component builds it. */
const area = (id: string, rings: PlanePoint[][]) => ({
  id,
  geometry: { rings, bounds: planeBounds(rings), area: planeArea(rings), path: '' },
});

describe('which area a tap means', () => {
  const big = area('big', [square(0, 0, 100), square(40, 40, 20)]);
  const inHole = area('hole', [square(40, 40, 20)]);
  const sliver = area('sliver', [square(200, 0, 1)]);

  it('is the area holding the point', () => {
    expect(hitRegion([big, inHole, sliver], { x: 10, y: 10 }, 5)).toBe('big');
  });

  it('is the area in the hole, not the one around it', () => {
    expect(hitRegion([big, inHole, sliver], { x: 50, y: 50 }, 5)).toBe('hole');
  });

  it('is the smallest when two hold the point', () => {
    const overlapping = area('small', [square(0, 0, 30)]);
    expect(hitRegion([big, overlapping], { x: 10, y: 10 }, 5)).toBe('small');
  });

  it('reaches a sliver from a tap beside it, within the tolerance', () => {
    expect(hitRegion([big, inHole, sliver], { x: 203, y: 0.5 }, 5)).toBe('sliver');
  });

  it('is the sliver for a finger on the big area right beside it', () => {
    const wide = area('wide', [square(100, 0, 100)]);
    expect(hitRegion([wide, sliver], { x: 197, y: 0.5 }, 5)).toBe('sliver');
    // Further in, the big area again.
    expect(hitRegion([wide, sliver], { x: 150, y: 0.5 }, 5)).toBe('wide');
  });

  it('is nothing on empty map beyond the tolerance', () => {
    expect(hitRegion([big, inHole, sliver], { x: 150, y: 150 }, 5)).toBeNull();
  });
});

describe('the view', () => {
  it('fits the largest circle with a margin, square', () => {
    const view = viewBoxFor(3000, null);
    expect(view?.minX).toBeCloseTo(-3360);
    expect(view?.minY).toBeCloseTo(-3360);
    expect(view?.spanX).toBeCloseTo(6720);
    expect(view?.spanY).toBe(view?.spanX);
  });

  it('fits every area when there is no circle', () => {
    expect(viewBoxFor(null, { minX: 0, minY: 0, spanX: 200, spanY: 100 }, 0)).toEqual({
      minX: 0,
      minY: -50,
      spanX: 200,
      spanY: 200,
    });
  });

  it('is nothing with neither', () => {
    expect(viewBoxFor(null, null)).toBeNull();
  });

  it('puts a label at the centroid, pulled back inside the view', () => {
    const view = { minX: 0, minY: 0, spanX: 1000, spanY: 1000 };
    expect(labelPosition([square(400, 400, 200)], view)).toEqual({ fractionX: 0.5, fractionY: 0.5 });
    expect(labelPosition([square(-500, 400, 200)], view)).toEqual({ fractionX: 0.04, fractionY: 0.5 });
  });

  it('orders by the largest ring', () => {
    expect(planeArea([square(0, 0, 10), square(2, 2, 2)])).toBe(100);
  });
});

describe('extent', () => {
  it('reads a long list without spreading it into arguments', () => {
    const many = Array.from({ length: 200_000 }, (_, i) => i - 7);
    expect(extent(many)).toEqual({ min: -7, max: 199_992 });
    expect(extent([])).toBeNull();
  });
});

describe('the projection', () => {
  it('puts the centre at the origin, north up and east right, in metres', () => {
    const { project } = projectionAt({ latitude: 0, longitude: 0 });
    expect(project([0, 0])).toEqual({ x: 0, y: -0 });
    const north = project([0.001, 0]);
    expect(north.y).toBeCloseTo(-111.2, 1);
    expect(project([0, 0.001]).x).toBeCloseTo(111.2, 1);
  });
});

describe('an encoded polyline', () => {
  it("reads Google's reference string", () => {
    // developers.google.com/maps/documentation/utilities/polylinealgorithm
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('is no points when empty', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('which labels are drawn', () => {
  const area = (id: string, name: string, size: number, excluded = false) => ({
    id,
    name,
    excluded,
    geometry: { area: size },
  });

  it('ranks highlighted, then excluded, then the larger area, then the name', () => {
    const ranked = labelOrder(
      [area('a', 'Bravo', 10), area('b', 'Alfa', 10), area('c', 'Big', 99), area('d', 'Ex', 1, true), area('e', 'Hi', 1)],
      new Set(['e']),
    );
    expect(ranked.map((a) => a.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('hides a label whose box overlaps one already drawn, and keeps one that does not', () => {
    const placed = placeLabels(
      [
        { fractionX: 0.5, fractionY: 0.5, spanX: 100, spanY: 14 },
        { fractionX: 0.55, fractionY: 0.51, spanX: 120, spanY: 14 },
        { fractionX: 0.5, fractionY: 0.8, spanX: 100, spanY: 14 },
      ],
      { spanX: 400, spanY: 400 },
      4,
    );
    expect(placed.map((p) => p.visible)).toEqual([true, false, true]);
  });

  it('pulls a label in from the edge by its own size before judging a collision', () => {
    const [placed] = placeLabels([{ fractionX: 0, fractionY: 1, spanX: 80, spanY: 14 }], { spanX: 400, spanY: 400 }, 4);
    expect(placed).toEqual({ x: 44, y: 389, visible: true });
    expect(clampCentre(5, 40, 60, 4)).toBe(30);
  });
});
