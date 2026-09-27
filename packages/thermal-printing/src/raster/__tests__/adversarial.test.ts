import { describe, expect, it } from "vitest";

import { MAX_SVG_LENGTH, rasterizeSvg } from "../index";

/**
 * The SVG is uploaded by whoever owns the artwork, so it is untrusted input.
 *
 * Every assertion here is on WHAT happened — the refusal reason, the size of
 * what came back, the work estimate — never on how fast a runner was. The
 * scanner is linear and the budget refuses before filling, so each case is
 * deterministic; the one wall-clock check is a hang detector, ten seconds,
 * for a regression back to the polynomial patterns these inputs target (they
 * took over a minute).
 */

const N = 200_000;

const HANG_MS = 10_000;

/** `run`'s result, failing the test only if it effectively hung. */
function guarded<T>(run: () => T): T {
  const start = process.hrtime.bigint();
  const result = run();
  expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(HANG_MS);
  return result;
}

describe("rasterizeSvg on hostile input", () => {
  it.each([
    ["unterminated comments", `<svg viewBox="0 0 1 1">${"<!--".repeat(N / 4)}`],
    ["unterminated processing instructions", `<svg viewBox="0 0 1 1">${"<?".repeat(N / 2)}`],
    ["unterminated CDATA", `<svg viewBox="0 0 1 1">${"<![CDATA[".repeat(N / 9)}`],
    ["unterminated declarations", `<svg viewBox="0 0 1 1">${"<!".repeat(N / 2)}`],
    ["an unterminated tag name", `<svg viewBox="0 0 1 1"><${"A".repeat(N)}`],
    ["many open angle brackets", `<svg viewBox="0 0 1 1">${"<A".repeat(N / 2)}`],
    ["an attribute name of dashes", `<svg viewBox="0 0 1 1"><rect ${"-".repeat(N)}/></svg>`],
    ["an unterminated quoted value", `<svg viewBox="0 0 1 1"><rect x="${"1".repeat(N)}`],
    ["a transform of open parens", `<svg viewBox="0 0 1 1"><g transform="${"0(".repeat(N / 2)}"/></svg>`],
    ["a path of one enormous number", `<svg viewBox="0 0 1 1"><path d="M${"1".repeat(N)}x"/></svg>`],
    ["a path of dots", `<svg viewBox="0 0 1 1"><path d="M${".".repeat(N)}"/></svg>`],
  ])("reads %s to an empty 8 x 8 picture", (_label, svg) => {
    const raster = guarded(() => rasterizeSvg(svg, { width: 8 }));

    // Nothing drawable survives any of these; what matters is that the scan
    // ended and the document was sized, not refused or thrown on.
    expect([raster.width, raster.height]).toEqual([8, 8]);
    expect(raster.data.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a canvas taller than the cap, from the viewBox aspect, without allocating", () => {
    const raster = guarded(() =>
      rasterizeSvg('<svg viewBox="0 0 1 500"><rect width="1" height="500"/></svg>', { width: 576 }),
    );

    expect(raster.unsupported).toEqual(["output too large"]);
    expect(raster.data.length).toBe(0);
  });

  it.each([
    ["an overflowing rotation", 'transform="rotate(1e308)"'],
    ["stacked translations", 'transform="translate(1e308) translate(1e308) translate(-1e308)"'],
    ["an overflowing scale", 'transform="scale(1e308) scale(1e308)"'],
  ])("still refuses full-canvas shapes after one with %s", (_label, poison) => {
    const full = '<path d="M0 0H1V1H0Z"/>'.repeat(3_000);
    const svg = `<svg viewBox="0 0 1 1"><path d="M0 0L1 1L0 2Z" ${poison}/>${full}</svg>`;

    const raster = guarded(() => rasterizeSvg(svg, { width: 576 }));

    // A non-finite shape once poisoned the running cost with NaN and switched
    // the cap off for every shape after it (FUT-2784 review).
    expect(raster.unsupported).toEqual(["too complex to fill"]);
    expect(raster.data.length).toBe(0);
  });

  it("refuses an explicit width or height past the cap", () => {
    expect(rasterizeSvg('<svg viewBox="0 0 1 1"/>', { width: 5_000 }).unsupported).toEqual(["output too large"]);
    expect(rasterizeSvg('<svg viewBox="0 0 1 1"/>', { width: 8, height: 5_000 }).unsupported).toEqual([
      "output too large",
    ]);
  });

  it("refuses thousands of full-canvas shapes while parsing", () => {
    const svg = `<svg viewBox="0 0 1 1">${'<path d="M0 0H1V1Z"/>'.repeat(11_000)}</svg>`;

    expect(svg.length).toBeLessThan(MAX_SVG_LENGTH);
    const raster = guarded(() => rasterizeSvg(svg, { width: 576 }));

    expect(raster.unsupported).toEqual(["too many shapes"]);
    expect(raster.data.length).toBe(0);
  });

  it("refuses full-canvas shapes under the shape cap on the fill estimate", () => {
    const svg = `<svg viewBox="0 0 1 1">${'<path d="M0 0H1V1Z"/>'.repeat(3_000)}</svg>`;
    const raster = guarded(() => rasterizeSvg(svg, { width: 576 }));

    expect(raster.unsupported).toEqual(["too complex to fill"]);
    expect(raster.data.length).toBe(0);
  });

  it("refuses a path of full-height zigzags on the fill estimate", () => {
    const svg = `<svg viewBox="0 0 1 1"><path d="M0 0${"L.5 1L0 0".repeat(28_000)}"/></svg>`;

    expect(svg.length).toBeLessThan(MAX_SVG_LENGTH);
    const raster = guarded(() => rasterizeSvg(svg, { width: 576 }));

    expect(raster.unsupported).toEqual(["too complex to fill"]);
    expect(raster.data.length).toBe(0);
  });

  it("refuses a document past the size cap without reading it", () => {
    const huge = `<svg viewBox="0 0 1 1">${" ".repeat(MAX_SVG_LENGTH)}</svg>`;
    const raster = rasterizeSvg(huge, { width: 8 });

    expect(raster.unsupported).toEqual(["too large"]);
  });
});

describe("the tag scanner", () => {
  it("ignores tags inside comments and CDATA, and a > inside a quoted value", () => {
    const svg =
      '<?xml version="1.0"?><!DOCTYPE svg><svg viewBox="0 0 10 10">' +
      '<!-- <rect width="10" height="10"/> --><![CDATA[<rect width="10" height="10"/>]]>' +
      '<rect data-note="a > b" width="5" height="10"/></svg>';
    const raster = rasterizeSvg(svg, { width: 10 });
    const alpha = (x: number): number => raster.data[(5 * 10 + x) * 4 + 3] ?? 0;

    expect(alpha(2)).toBe(255);
    expect(alpha(7)).toBe(0);
  });

  it("reads single-quoted attributes and spaces around =", () => {
    const raster = rasterizeSvg("<svg viewBox = '0 0 2 2'><rect width = '2' height='2' fill = 'white'/></svg>", { width: 2 });

    expect([...raster.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });
});
