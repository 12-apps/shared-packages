import { describe, expect, it } from 'vitest';

import {
  decodePolyline,
  hitRegion,
  labelPosition,
  planeArea,
  projectionAt,
  ringsContain,
  ringsDistance,
  viewBoxFor,
  type PlanePoint,
} from '../RegionMap.helpers';

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

describe('which area a tap means', () => {
  const big = { id: 'big', rings: [square(0, 0, 100), square(40, 40, 20)], area: 10_000 };
  const inHole = { id: 'hole', rings: [square(40, 40, 20)], area: 400 };
  const sliver = { id: 'sliver', rings: [square(200, 0, 1)], area: 1 };

  it('is the area holding the point', () => {
    expect(hitRegion([big, inHole, sliver], { x: 10, y: 10 }, 5)).toBe('big');
  });

  it('is the area in the hole, not the one around it', () => {
    expect(hitRegion([big, inHole, sliver], { x: 50, y: 50 }, 5)).toBe('hole');
  });

  it('is the smallest when two hold the point', () => {
    const overlapping = { id: 'small', rings: [square(0, 0, 30)], area: 900 };
    expect(hitRegion([big, overlapping], { x: 10, y: 10 }, 5)).toBe('small');
  });

  it('reaches a sliver from a tap beside it, within the tolerance', () => {
    expect(hitRegion([big, inHole, sliver], { x: 203, y: 0.5 }, 5)).toBe('sliver');
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
    expect(labelPosition([square(-500, 400, 200)], view)).toEqual({ fractionX: 0.15, fractionY: 0.5 });
  });

  it('orders by the largest ring', () => {
    expect(planeArea([square(0, 0, 10), square(2, 2, 2)])).toBe(100);
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
