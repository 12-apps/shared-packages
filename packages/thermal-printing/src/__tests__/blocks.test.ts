import { describe, expect, it } from "vitest";

import { band, box, columnsFor, image, row, textLines, wrap } from "../index";

/**
 * The size-aware builders. Each yields plain text plus a flag, so what is
 * asserted here is exactly what both encoders print.
 */

const texts = (lines: readonly { text: string }[]): string[] => lines.map((entry) => entry.text);

describe("textLines", () => {
  it("wraps at the column count of its OWN size", () => {
    const long = "one two three four five six seven eight nine ten eleven";
    for (const size of ["small", "medium", "large", "xlarge"] as const) {
      for (const produced of textLines(long, 80, { size })) {
        expect(produced.text.length).toBeLessThanOrEqual(columnsFor(80, size));
        expect(produced.size).toBe(size);
      }
    }
    expect(textLines(long, 80, { size: "xlarge" }).length).toBeGreaterThan(1);
  });

  it("defaults to medium, plain, left", () => {
    expect(textLines("ok", 80)).toEqual([{ text: "ok", align: "left", emphasis: "normal", size: "medium" }]);
  });

  it("carries bold and centre alignment", () => {
    expect(textLines("ORDER #0042", 80, { size: "xlarge", bold: true, align: "center" })).toEqual([
      { text: "ORDER #0042", align: "center", emphasis: "bold", size: "xlarge" },
    ]);
  });

  it("keeps a blank spacer line rather than dropping it", () => {
    expect(texts(textLines("", 58, { size: "large" }))).toEqual([""]);
  });
});

describe("band", () => {
  it("pads every line to the full width so the black runs edge to edge", () => {
    const lines = band("CANCELLED", 80);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toHaveLength(48);
    expect(lines[0]?.text.trim()).toBe("CANCELLED");
    expect(lines[0]?.frame).toBe("band");
    expect(lines[0]?.emphasis).toBe("bold");
  });

  it("centres the text", () => {
    const [only] = band("AB", 58, { size: "xlarge" });

    expect(only?.text).toBe(`${" ".repeat(7)}AB${" ".repeat(7)}`);
  });

  it("wraps into a taller band, each line full width", () => {
    const lines = band("a band long enough to need two lines", 58, { size: "large" });

    expect(lines.length).toBeGreaterThan(1);
    for (const entry of lines) expect(entry.text).toHaveLength(21);
  });
});

describe("box", () => {
  it("draws a border the full width of the roll with the text centred inside", () => {
    expect(texts(box("BRING CHANGE", 58))).toEqual([
      `┌${"─".repeat(30)}┐`,
      `│ ${" ".repeat(8)}BRING CHANGE${" ".repeat(8)} │`,
      `└${"─".repeat(30)}┘`,
    ]);
  });

  it("flags every line as a box and makes it bold by default", () => {
    for (const entry of box("x", 80)) {
      expect(entry.frame).toBe("box");
      expect(entry.emphasis).toBe("bold");
    }
    expect(box("x", 80, { bold: false })[1]?.emphasis).toBe("normal");
  });

  it("wraps inside the border", () => {
    const lines = box("a boxed instruction that is too long for one line", 58, { size: "large" });

    expect(lines.length).toBeGreaterThan(3);
    for (const entry of lines) expect(entry.text).toHaveLength(21);
  });
});

describe("row", () => {
  it("puts the amount flush right on a line the full width of the roll", () => {
    const [only] = row("Subtotal", "42.00", 80);

    expect(only?.text).toBe(`Subtotal${" ".repeat(48 - 8 - 5)}42.00`);
    expect(only?.text).toHaveLength(48);
  });

  it("wraps a long label beside the amount, amount on the first line", () => {
    const lines = texts(row("Large pepperoni pizza with extra cheese", "123.45", 58, { indent: 3 }));

    expect(lines[0]).toMatch(/ 123\.45$/);
    expect(lines[0]).toHaveLength(32);
    for (const produced of lines.slice(1)) {
      expect(produced.length).toBeLessThanOrEqual(32 - 7);
      expect(produced.startsWith("   ")).toBe(true);
    }
  });

  it("uses the column count of its size", () => {
    const [only] = row("TOTAL", "55.00", 58, { size: "large", bold: true });

    expect(only).toEqual({ text: `TOTAL${" ".repeat(11)}55.00`, align: "left", emphasis: "bold", size: "large" });
  });

  it("gives an amount too long to share the line a line of its own", () => {
    const amount = "1234567890.00 (converted)";
    const lines = texts(row("Paid", amount, 58, { size: "large" }));

    expect(lines[0]).toBe("Paid");
    expect(lines.slice(1).join(" ").replace(/\s+/g, " ").trim()).toBe(amount);
    for (const produced of lines) expect(produced.length).toBeLessThanOrEqual(21);
  });

  it("never returns a line wider than its size allows, on either roll", () => {
    for (const width of [58, 80]) {
      for (const size of ["small", "medium", "large", "xlarge"] as const) {
        for (const produced of row("Delivery fee for a long distance", "9.99", width, { size })) {
          expect(produced.text.length).toBeLessThanOrEqual(columnsFor(width, size));
        }
      }
    }
  });
});

describe("image", () => {
  it("is a line with no text that carries the raster, centred by default", () => {
    const raster = { width: 8, height: 1, data: Uint8Array.of(0xff) };

    expect(image(raster)).toEqual({ text: "", align: "center", emphasis: "normal", image: raster });
    expect(image(raster, "left").align).toBe("left");
  });
});

describe("wrap", () => {
  it("survives an indent as wide as the roll instead of looping forever", () => {
    expect(wrap("abc def", 4, 10)).toEqual(["a b", "   c", "   d", "   e", "   f"]);
  });
});
