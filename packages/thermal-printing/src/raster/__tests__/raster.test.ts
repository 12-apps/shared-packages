import { describe, expect, it } from "vitest";

import type { RasterImage } from "../../index";
import { DEFAULT_THRESHOLD, isFlatArtwork, luma, rasterizeSvg, toMonochrome, type RgbaImage } from "../index";

/**
 * Pictures for a one-colour head.
 *
 * The case this module exists for: a mark whose body is a mid-tone colour
 * printed as two dots — the only two features darker than 50 % grey — because
 * nothing decided what one bit of it should look like.
 */

const dot = (raster: RasterImage, x: number, y: number): boolean =>
  ((raster.data[y * Math.ceil(raster.width / 8) + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;

const inked = (raster: RasterImage): number =>
  Array.from({ length: raster.width * raster.height }, (_, i) =>
    dot(raster, i % raster.width, Math.floor(i / raster.width)),
  ).filter(Boolean).length;

function solid(width: number, height: number, [r, g, b, a]: readonly number[]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([r ?? 0, g ?? 0, b ?? 0, a ?? 255], i * 4);
  return { width, height, data };
}

/**
 * A one-plate mark: a solid dome with a white eye knocked out of it, a pupil
 * inside the eye, and a white mouth. Four shapes, drawn for this test.
 */
const markSvg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<path d="M10 90C10 40 30 10 50 10S90 40 90 90Q90 95 85 95H15Q10 95 10 90Z" fill="${body}"/>` +
  `<circle cx="50" cy="45" r="20" fill="#FFFFFF"/>` +
  `<circle cx="54" cy="48" r="9" fill="#000"/>` +
  `<path d="M35 72c4 12 26 12 30 0z" fill="#fff"/>` +
  `</svg>`;

describe("a one-colour mark rasterised at the printer's dot size", () => {
  const mono = toMonochrome(rasterizeSvg(markSvg("#000000"), { width: 96 }));

  it("prints the BODY, not just a couple of dots", () => {
    // The dome covers roughly 60 % of the square; the eye and mouth take some
    // back. Two dots — the failure this guards — would be a handful of pixels.
    expect(mono.width).toBe(96);
    expect(mono.height).toBe(96);
    expect(inked(mono) / (96 * 96)).toBeGreaterThan(0.35);
    // Body pixels well away from any feature.
    expect(dot(mono, 20, 80)).toBe(true);
    expect(dot(mono, 48, 20)).toBe(true);
  });

  it("keeps the eye knocked out, with the pupil inside it", () => {
    expect(dot(mono, 40, 38)).toBe(false); // white of the eye
    expect(dot(mono, 52, 46)).toBe(true); // pupil
    expect(dot(mono, 48, 74)).toBe(false); // mouth
  });

  it("is thresholded, since it is flat artwork", () => {
    expect(mono.method).toBe("threshold");
  });
});

describe("the orange-logo policy", () => {
  const ORANGE = [0xed, 0x7a, 0x1f, 255];

  it("measures the orange as a mid-tone", () => {
    expect(luma(0xed, 0x7a, 0x1f)).toBeCloseTo(0.57, 2);
  });

  it("vanishes under a plain 50 % threshold — the failure on paper", () => {
    expect(inked(toMonochrome(solid(16, 16, ORANGE), { mode: "threshold", threshold: 0.5 }))).toBe(0);
  });

  it("prints solid black under the default policy for flat artwork", () => {
    const mono = toMonochrome(solid(16, 16, ORANGE));

    expect(DEFAULT_THRESHOLD).toBe(0.75);
    expect(mono.method).toBe("threshold");
    expect(inked(mono)).toBe(16 * 16);
  });

  it("prints the whole orange mark as a black silhouette with the eye knocked out", () => {
    const orange = toMonochrome(rasterizeSvg(markSvg("#ED7A1F"), { width: 96 }));
    const black = toMonochrome(rasterizeSvg(markSvg("#000000"), { width: 96 }));

    // Only the anti-aliased rim differs: an orange edge pixel needs more
    // coverage than a black one to cross the threshold.
    expect(inked(orange) / inked(black)).toBeGreaterThan(0.95);
    expect(dot(orange, 40, 38)).toBe(false);
  });

  it("becomes a dot pattern of about 40 % when dithered", () => {
    const ratio = inked(toMonochrome(solid(64, 64, ORANGE), { mode: "dither" })) / (64 * 64);

    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.55);
  });

  it("drops a pale tint above the threshold, which is what the preview is for", () => {
    expect(inked(toMonochrome(solid(8, 8, [0xff, 0xf0, 0x99, 255])))).toBe(0);
  });
});

describe("toMonochrome", () => {
  it("refuses a buffer that does not match its dimensions", () => {
    expect(() => toMonochrome({ width: 4, height: 4, data: new Uint8ClampedArray(10) })).toThrow(RangeError);
  });

  it("refuses dimensions past the raster cap before allocating", () => {
    const huge = { width: 100_000, height: 100_000, data: new Uint8ClampedArray(0) };

    expect(() => toMonochrome(huge)).toThrow(RangeError);
  });

  it("treats a transparent pixel as paper", () => {
    expect(inked(toMonochrome(solid(8, 8, [0, 0, 0, 0])))).toBe(0);
  });

  it("packs rows MSB-first and pads each to a whole byte", () => {
    const image = solid(10, 2, [255, 255, 255, 255]);
    image.data.set([0, 0, 0, 255], 0); // (0, 0)
    image.data.set([0, 0, 0, 255], (1 * 10 + 9) * 4); // (9, 1)
    const mono = toMonochrome(image, { mode: "threshold" });

    expect([...mono.data]).toEqual([0x80, 0x00, 0x00, 0x40]);
  });

  it("dithers a photograph and thresholds a logo when left to decide", () => {
    const noise: RgbaImage = {
      width: 64,
      height: 64,
      data: Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, o) => {
        const v = ((o >> 2) * 97 + (o >> 8) * 31) % 256;
        return [v, (v * 7) % 256, (v * 13) % 256, 255][o % 4] ?? 255;
      }),
    };

    expect(isFlatArtwork(noise)).toBe(false);
    expect(toMonochrome(noise).method).toBe("atkinson");
    expect(toMonochrome(noise, { kernel: "floyd-steinberg" }).method).toBe("floyd-steinberg");
    expect(isFlatArtwork(rasterizeSvg(markSvg("#000"), { width: 96 }))).toBe(true);
  });

  it("dithers a mid grey to about half ink with either kernel", () => {
    for (const kernel of ["atkinson", "floyd-steinberg"] as const) {
      const ratio = inked(toMonochrome(solid(64, 64, [128, 128, 128, 255]), { mode: "dither", kernel })) / 4096;
      expect(ratio).toBeGreaterThan(0.35);
      expect(ratio).toBeLessThan(0.65);
    }
  });
});

describe("rasterizeSvg", () => {
  const pixel = (raster: RgbaImage, x: number, y: number): number[] =>
    [...raster.data.slice((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4)];

  it("sizes the height from the viewBox and fits it, centred", () => {
    const raster = rasterizeSvg('<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>', { width: 40 });

    expect([raster.width, raster.height]).toEqual([40, 20]);
    expect(pixel(raster, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(raster, 39, 19)).toEqual([0, 0, 0, 255]);
  });

  it("letterboxes into an explicit height with meet", () => {
    const raster = rasterizeSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', { width: 30, height: 10 });

    expect(pixel(raster, 0, 5)[3]).toBe(0);
    expect(pixel(raster, 15, 5)[3]).toBe(255);
  });

  it("honours transforms, groups and inherited fills", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><g fill="#fff" transform="translate(5 0)">' +
      '<rect width="5" height="10"/></g></svg>';
    const raster = rasterizeSvg(svg, { width: 10 });

    expect(pixel(raster, 2, 5)[3]).toBe(0);
    expect(pixel(raster, 7, 5)).toEqual([255, 255, 255, 255]);
  });

  it("applies the even-odd rule", () => {
    const ring = '<svg viewBox="0 0 10 10"><path fill-rule="evenodd" d="M0 0H10V10H0Z M3 3H7V7H3Z"/></svg>';
    const raster = rasterizeSvg(ring, { width: 10 });

    expect(pixel(raster, 1, 1)[3]).toBe(255);
    expect(pixel(raster, 5, 5)[3]).toBe(0);
  });

  it("draws arcs, including flags run together with the next number", () => {
    // Two half-circle arcs; "1010 0" is large-arc 1, sweep 0, then x = 10.
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 5a5 5 0 1010 0a5 5 0 10-10 0z"/></svg>';
    const raster = rasterizeSvg(svg, { width: 10 });

    expect(pixel(raster, 5, 5)[3]).toBe(255);
    expect(pixel(raster, 5, 1)[3]).toBe(255);
    expect(pixel(raster, 0, 0)[3]).toBe(0);
    expect(pixel(raster, 9, 9)[3]).toBe(0);
  });

  it("composes rotate, scale and matrix transforms", () => {
    const rotated = '<svg viewBox="0 0 10 10"><g transform="rotate(90 5 5)"><rect width="5" height="10"/></g></svg>';
    const scaled = '<svg viewBox="0 0 10 10"><rect width="2" height="2" transform="matrix(1 0 0 1 1 1) scale(2)"/></svg>';

    expect(pixel(rasterizeSvg(rotated, { width: 10 }), 5, 2)[3]).toBe(255);
    expect(pixel(rasterizeSvg(rotated, { width: 10 }), 5, 8)[3]).toBe(0);
    expect(pixel(rasterizeSvg(scaled, { width: 10 }), 4, 4)[3]).toBe(255);
    expect(pixel(rasterizeSvg(scaled, { width: 10 }), 0, 0)[3]).toBe(0);
    expect(pixel(rasterizeSvg(scaled, { width: 10 }), 6, 6)[3]).toBe(0);
  });

  it("draws a rounded rect and an ellipse", () => {
    const svg = '<svg viewBox="0 0 20 10"><rect width="10" height="10" rx="5"/><ellipse cx="15" cy="5" rx="5" ry="3"/></svg>';
    const raster = rasterizeSvg(svg, { width: 20 });

    expect(pixel(raster, 0, 0)[3]).toBe(0); // the rounded corner is empty
    expect(pixel(raster, 5, 5)[3]).toBe(255);
    expect(pixel(raster, 15, 1)[3]).toBe(0); // above the ellipse
    expect(pixel(raster, 15, 5)[3]).toBe(255);
  });

  it("anti-aliases an edge that falls mid-pixel", () => {
    const raster = rasterizeSvg('<svg viewBox="0 0 4 4"><rect width="1.5" height="4"/></svg>', { width: 4 });

    expect(pixel(raster, 1, 2)[3]).toBeGreaterThan(100);
    expect(pixel(raster, 1, 2)[3]).toBeLessThan(160);
  });

  it("names what it did not draw instead of guessing", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs>' +
      '<rect width="10" height="10" fill="url(#g)" stroke="#000"/><text>hi</text>' +
      '<image href="x.png"/><use href="#a"/></svg>';
    const raster = rasterizeSvg(svg, { width: 10 });

    expect(raster.unsupported).toEqual(expect.arrayContaining(["fill:url(#g)", "stroke", "text", "image", "use"]));
    // The gradient-filled shape is still there, in black.
    expect(pixel(raster, 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it("reflects S from the current point after a quadratic, as the spec says", () => {
    // Q leaves a quadratic control point; S must NOT reflect it, so its first
    // control point is the current point and the curve bulges only to the
    // right of the chord. Reflecting (5,0) would pull it up to the top rows.
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 10Q5 0 5 10S10 10 10 10Z"/></svg>';
    const correct = rasterizeSvg(svg, { width: 10 });
    const inked = (x: number, y: number): boolean => (pixel(correct, x, y)[3] ?? 0) > 128;

    expect(inked(7, 2)).toBe(false);
  });

  it("ignores a stray closing tag instead of dropping the root's viewport", () => {
    const svg = '<svg viewBox="0 0 10 10"></g></g><rect x="5" width="5" height="10"/></svg>';
    const raster = rasterizeSvg(svg, { width: 20 });

    // Scaled x2 by the viewport: the rect covers x 10-19, not x 5-9.
    expect(pixel(raster, 7, 5)[3]).toBe(0);
    expect(pixel(raster, 15, 5)[3]).toBe(255);
  });

  it("skips hidden elements and reads fill from style", () => {
    const svg =
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" style="fill:#ff0000"/>' +
      '<rect width="10" height="10" display="none"/></svg>';

    expect(pixel(rasterizeSvg(svg, { width: 10 }), 5, 5)).toEqual([255, 0, 0, 255]);
  });

  it("refuses, with the reason, a document it cannot size", () => {
    const raster = rasterizeSvg("<svg><rect width='1' height='1'/></svg>", { width: 8 });

    expect(raster.unsupported).toEqual(["no viewBox or size"]);
    expect([raster.width, raster.height, raster.data.length]).toEqual([0, 0, 0]);
    expect(rasterizeSvg("not svg", { width: 8 }).unsupported).toEqual(["no <svg> root"]);
  });
});
