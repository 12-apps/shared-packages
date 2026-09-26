import { describe, expect, it } from "vitest";

import { MAX_SVG_LENGTH, rasterizeSvg } from "../index";

/**
 * The SVG is uploaded by whoever owns the artwork, so it is untrusted input.
 * Each case here is a shape that makes a backtracking pattern go polynomial;
 * the scanner reads each in one pass, so every one must finish quickly.
 */

const N = 200_000;

/**
 * Wall time of `run`, in milliseconds. A time bound is the assertion here, so
 * the bounds are generous: a linear pass takes milliseconds, the polynomial
 * patterns these inputs target took over a minute on the same machine.
 */
function timed(run: () => unknown): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const BOUND_MS = 2_000;

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
  ])("finishes quickly on %s", (_label, svg) => {
    expect(timed(() => rasterizeSvg(svg, { width: 8 }))).toBeLessThan(BOUND_MS);
  });

  it("bounds the fill of a path as dense as the cap allows", () => {
    // Every segment spans the full height: the worst case for scan conversion.
    const zigzag = Array.from({ length: 8_000 }, (_, i) => `L${(i % 100) / 100} ${i % 2}`).join("");
    const svg = `<svg viewBox="0 0 1 1"><path d="M0 0${zigzag}Z"/></svg>`;

    expect(svg.length).toBeLessThan(MAX_SVG_LENGTH);
    expect(timed(() => rasterizeSvg(svg, { width: 384, height: 96 }))).toBeLessThan(10_000);
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
