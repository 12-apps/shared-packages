import { describe, expect, it } from "vitest";

import { rasterToDataUri, renderTicketHtml } from "../index";
import { band, box, centered, image, line, row, textLines, type TicketLine } from "../../index";

/**
 * The newer line kinds as markup. The text of each line is asserted to be the
 * very string the line model produced, which is what "the same ticket on both
 * transports" means in practice.
 */

const bodyOf = (html: string): string => html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

describe("legacy tickets", () => {
  it("render exactly the markup they always did", () => {
    const html = renderTicketHtml([line("A", "bold"), centered("B", "double"), line("")], 80);

    expect(bodyOf(html)).toBe(
      '<div style="font-weight:700">A</div>' +
        '<div style="font-weight:700;font-size:2em;line-height:1.1;text-align:center">B</div>' +
        "<div>&nbsp;</div>",
    );
  });
});

describe("sizes", () => {
  it.each([
    [80, "small", "font-size:0.75em"],
    [80, "large", "font-size:1.5em"],
    [80, "xlarge", "font-size:2em"],
    [58, "small", "font-size:0.7619em"],
    [58, "large", "font-size:1.5238em"],
    [58, "xlarge", "font-size:2em"],
  ] as const)("sets %smm %s so its column count spans the roll (%s)", (width, size, css) => {
    expect(bodyOf(renderTicketHtml(textLines("Z", width, { size }), width))).toBe(`<div style="${css}">Z</div>`);
  });

  it("renders medium at the body size, and bold as weight", () => {
    expect(bodyOf(renderTicketHtml(textLines("Z", 80), 80))).toBe("<div>Z</div>");
    expect(bodyOf(renderTicketHtml(textLines("Z", 80, { bold: true }), 80))).toBe(
      '<div style="font-weight:700">Z</div>',
    );
  });
});

describe("band", () => {
  it("is white on black and forces the background to print", () => {
    const lines = band("VOID", 80);
    const html = bodyOf(renderTicketHtml(lines, 80));

    expect(html).toContain("background:#000;color:#fff");
    // Without this, a browser drops backgrounds when printing: white on white.
    expect(html).toContain("print-color-adjust:exact");
    expect(html).toContain(`>${lines[0]?.text}</div>`);
  });
});

describe("box", () => {
  it("draws the same border characters, with the line gap closed", () => {
    const lines = box("OK", 58);
    const html = bodyOf(renderTicketHtml(lines, 58));

    for (const entry of lines) expect(html).toContain(`line-height:1">${entry.text}</div>`);
  });
});

describe("row", () => {
  it("renders the padded row verbatim; white-space:pre keeps the gap", () => {
    const [only] = row("Total", "9.90", 80);
    const html = renderTicketHtml(row("Total", "9.90", 80), 80);

    expect(html).toContain(`<div>${only?.text}</div>`);
    expect(html).toContain("white-space:pre");
  });
});

describe("image", () => {
  const raster = { width: 576, height: 2, data: new Uint8Array(72 * 2).fill(0xff) };

  it("inlines the raster as a data URI, sized to the roll in characters", () => {
    const html = bodyOf(renderTicketHtml([image(raster)], 80));

    expect(html).toContain('src="data:image/bmp;base64,');
    // 576 dots on an 80 mm roll is the whole printable width: 48 columns.
    expect(html).toContain("width:48ch");
    expect(html).toContain("margin:0 auto");
    expect(html).toContain("image-rendering:pixelated");
  });

  it("scales by 12 dots per character on either roll", () => {
    const small = { width: 96, height: 1, data: new Uint8Array(12) };

    expect(renderTicketHtml([image(small, "left")], 58)).toContain("width:8ch");
    expect(renderTicketHtml([image(small, "left")], 58)).toContain("margin:0;");
  });
});

describe("rasterToDataUri", () => {
  const decode = (uri: string): Uint8Array =>
    Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (char) => char.charCodeAt(0));

  it("is a 1-bit BMP with white at index 0 and black at index 1", () => {
    const bmp = decode(rasterToDataUri({ width: 3, height: 2, data: Uint8Array.of(0b1010_0000, 0b0100_0000) }));
    const u32 = (offset: number): number => new DataView(bmp.buffer).getUint32(offset, true);

    expect(String.fromCharCode(bmp[0] ?? 0, bmp[1] ?? 0)).toBe("BM");
    expect(u32(2)).toBe(bmp.length);
    expect(u32(18)).toBe(3); // width
    expect(u32(22)).toBe(2); // height, bottom-up
    expect(bmp[28]).toBe(1); // bits per pixel
    expect([...bmp.slice(54, 62)]).toEqual([0xff, 0xff, 0xff, 0, 0, 0, 0, 0]);
    // Rows padded to 4 bytes and stored bottom-up: row 1 first, then row 0.
    expect([...bmp.slice(62)]).toEqual([0b0100_0000, 0, 0, 0, 0b1010_0000, 0, 0, 0]);
  });
});

describe("both encoders print the same lines", () => {
  it("renders every text line of a mixed ticket verbatim", () => {
    const lines: TicketLine[] = [
      ...textLines("ORDER #0042", 80, { size: "xlarge", bold: true, align: "center" }),
      ...band("PAID", 80),
      ...row("Item", "10.00", 80),
      ...row("TOTAL", "10.00", 80, { size: "large", bold: true }),
      ...box("BRING CHANGE", 80),
      ...textLines("details", 80, { size: "small" }),
    ];
    const html = renderTicketHtml(lines, 80);

    for (const entry of lines) expect(html).toContain(`>${entry.text}</div>`);
  });
});
