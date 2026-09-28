import { describe, expect, it } from "vitest";

import { renderTicketHtml } from "../index";
import type { TicketLine } from "../../index";

/**
 * The document a CABLE printer prints.
 *
 * It exists because a USB printer has no address; it is built from the same
 * `TicketLine[]` the ESC/POS encoder takes, so a store that swaps a USB printer
 * for a Wi-Fi one gets the same ticket rather than a second layout.
 */

const line = (text: string, emphasis: TicketLine["emphasis"] = "normal"): TicketLine => ({
  text,
  align: "left",
  emphasis,
});

describe("renderTicketHtml", () => {
  it("sizes the page to the roll's PRINTABLE width, not the paper's", () => {
    expect(renderTicketHtml([line("ok")], 58)).toContain("width:48mm");
    expect(renderTicketHtml([line("ok")], 80)).toContain("width:72mm");
    expect(renderTicketHtml([line("ok")], 80)).not.toMatch(/width:\d+ch/);
  });

  it.each([
    [58, 32, 48],
    [80, 48, 72],
  ])("sets %smm type so %s columns fit inside %smm, with room to spare", (paper, columns, printable) => {
    const fontMm = Number(/font-size:([\d.]+)mm/.exec(renderTicketHtml([line("ok")], paper))?.[1]);
    // A monospace glyph advances 0.6 em (Courier New, Liberation Mono); one a
    // little wider (DejaVu Sans Mono, 0.602 em) must still fit.
    expect(columns * 0.6 * fontMm).toBeLessThanOrEqual(printable);
    expect(columns * 0.602 * fontMm).toBeLessThanOrEqual(printable);
    // …and the line still fills the roll: no more than 3 % left unused.
    expect(columns * 0.6 * fontMm).toBeGreaterThan(printable * 0.97);
  });

  it("prints pure black on white, never a grey a thermal head would dither", () => {
    const html = renderTicketHtml([line("ok")], 80);

    expect(html).toContain("color:#000");
    expect(html).toContain("background:#fff");
    expect(html).not.toMatch(/opacity|rgba?\(|#(?!000\b|fff\b)[0-9a-f]{3,6}\b/i);
  });

  it("thickens every stem past one printer dot, in the text's own colour", () => {
    const html = renderTicketHtml([line("ok")], 80);

    expect(html).toContain("-webkit-text-stroke-width:0.12mm");
    expect(html).toContain("-webkit-text-stroke-color:currentColor");
  });

  it("kills the page margin a driver would otherwise add to a receipt roll", () => {
    expect(renderTicketHtml([line("ok")], 80)).toContain("@page{margin:0}");
  });

  it("escapes a store-authored dish name rather than letting it open a tag", () => {
    const html = renderTicketHtml([line('Refri <2L> & "gelado"')], 80);

    expect(html).toContain("Refri &lt;2L&gt; &amp; &quot;gelado&quot;");
    expect(html).not.toContain("<2L>");
  });

  it("never lets a product name become markup in the tab that prints it", () => {
    const html = renderTicketHtml([line("<script>alert(1)</script>")], 80);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps a blank line occupying one", () => {
    expect(renderTicketHtml([line("")], 80)).toContain("&nbsp;");
  });

  it("matches the ESC/POS encoder: double height, never double width", () => {
    const html = renderTicketHtml([line("MESA 12", "double")], 80);

    // A doubled font size doubles the width too, and a full line runs off the roll.
    expect(html).not.toContain("font-size:2em");
    expect(html).toContain("transform:scaleY(2)");
    expect(html).toContain("margin-bottom:1.25em");
  });
});
