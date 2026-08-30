/**
 * What a printed sticker has to get right, and what a screen cannot show you.
 *
 * Every assertion here stands for a failure that is invisible until the job
 * comes back from the gráfica: an xref that disagrees with the file by one
 * byte, a code with its quiet zone trimmed off, a crop mark printed across the
 * artwork, or a black built from four plates.
 */
import { describe, expect, it } from "vitest";

import { buildQrStickerPdf, pdfDateOf, STICKER_SIZES, type QrSticker } from "../index";
import { mm } from "../pdf-doc";

const STICKER: QrSticker = {
  label: "Cerveja Pilsen 350ml",
  url: "https://loja.example.com/market/p/abc",
  hint: "Aponte a câmera e pague pelo celular",
};

function build(overrides: Partial<Parameters<typeof buildQrStickerPdf>[0]> = {}): string {
  const bytes = buildQrStickerPdf({
    stickers: [STICKER],
    size: STICKER_SIZES.small!,
    layout: "individual",
    brandName: "Bar do Zé",
    title: "QR do mercado",
    date: pdfDateOf(new Date("2026-08-30T12:00:00Z")),
    creator: "Test",
    ...overrides,
  });
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

/** Every `N 0 obj` offset the xref table claims, in order. */
function xrefOffsets(pdf: string): number[] {
  // `\nxref\n`, not `xref\n`: the trailer's own `startxref` ends in the same
  // five characters and sits AFTER the table, so the loose form slices past it.
  const table = pdf.slice(pdf.indexOf("\nxref\n"));
  return [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map(([, value]) => Number(value));
}

describe("the file a reader has to open", () => {
  it("starts with a PDF header and the binary-marker comment", () => {
    const pdf = build();
    expect(pdf.startsWith("%PDF-1.7\n")).toBe(true);
    // Line two marks the file binary so text-mode transfers do not mangle it.
    expect(pdf.split("\n")[1]).toBe("%\xE2\xE3\xCF\xD3");
  });

  it("writes an xref whose every offset lands exactly on its object", () => {
    // The failure this catches is total: an xref off by ONE byte is a file no
    // reader will open, and nothing about the artwork is wrong.
    const pdf = build();
    const offsets = xrefOffsets(pdf);
    expect(offsets.length).toBeGreaterThan(0);
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it("points startxref at the xref table", () => {
    const pdf = build();
    const declared = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(declared, declared + 4)).toBe("xref");
  });

  it("keeps every byte inside the range the writer can encode", () => {
    // The document is assembled as a string and widened to bytes at the end,
    // which is only sound while one character is one byte.
    const bytes = buildQrStickerPdf({
      stickers: [{ ...STICKER, label: "Pão — “especial” • Açaí" }],
      size: STICKER_SIZES.small!,
      layout: "individual",
      brandName: "Bar do Zé",
      title: "t",
      date: pdfDateOf(new Date()),
      creator: "Test",
    });
    expect(bytes.every((byte) => byte <= 0xff)).toBe(true);
  });
});

describe("what a print shop reads", () => {
  it("declares TrimBox and BleedBox rather than drawing a frame", () => {
    // Artwork that only LOOKS trimmed gets imposed by eye.
    const pdf = build();
    expect(pdf).toContain("/TrimBox");
    expect(pdf).toContain("/BleedBox");
    expect(pdf).toContain("/MediaBox");
  });

  it("runs the bleed outside the trim on all four sides", () => {
    const pdf = build();
    const trim = /\/TrimBox \[([\d. ]+)\]/.exec(pdf)?.[1]?.split(" ").map(Number) ?? [];
    const bleed = /\/BleedBox \[([\d. ]+)\]/.exec(pdf)?.[1]?.split(" ").map(Number) ?? [];
    expect(bleed[0]).toBeLessThan(trim[0]!);
    expect(bleed[1]).toBeLessThan(trim[1]!);
    expect(bleed[2]).toBeGreaterThan(trim[2]!);
    expect(bleed[3]).toBeGreaterThan(trim[3]!);
  });

  it("uses K-only black, never a four-plate rich black", () => {
    // A code built from four plates fringes on any misregistration, on artwork
    // whose whole job is to be read by a camera in bad light.
    const pdf = build();
    const fills = [...pdf.matchAll(/^([\d.]+ [\d.]+ [\d.]+ [\d.]+) k$/gm)].map(([, v]) => v);
    const strokes = [...pdf.matchAll(/^([\d.]+ [\d.]+ [\d.]+ [\d.]+) K$/gm)].map(([, v]) => v);
    expect(fills.length).toBeGreaterThan(0);
    expect(strokes.length).toBeGreaterThan(0);
    // Every ink this document sets is K alone. C, M or Y above zero anywhere
    // means a plate that can misregister against the others.
    expect([...new Set([...fills, ...strokes])]).toEqual(["0 0 0 1"]);
  });

  it("keeps every crop mark outside the bleed", () => {
    // A mark printed over the artwork is a mark on every sticker in the run.
    const pdf = build();
    const trim = /\/TrimBox \[([\d. ]+)\]/.exec(pdf)![1]!.split(" ").map(Number);
    const [tx0, ty0, tx1, ty1] = trim as [number, number, number, number];
    const gap = mm(3);
    const marks = [...pdf.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)];
    expect(marks.length).toBe(8); // four corners, two arms each
    for (const [, x1, y1, x2, y2] of marks) {
      const outside =
        Number(x1) <= tx0 - gap + 0.01 ||
        Number(x2) <= tx0 - gap + 0.01 ||
        Number(x1) >= tx1 + gap - 0.01 ||
        Number(x2) >= tx1 + gap - 0.01 ||
        Number(y1) <= ty0 - gap + 0.01 ||
        Number(y2) <= ty0 - gap + 0.01 ||
        Number(y1) >= ty1 + gap - 0.01 ||
        Number(y2) >= ty1 + gap - 0.01;
      expect(outside).toBe(true);
    }
  });

  it("leaves the code a quiet zone inside its own square", () => {
    // The single most common way a printed code stops scanning, and invisible
    // on screen because the browser gives it one for free.
    const pdf = build();
    const fills = [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)].map((m) =>
      m.slice(1).map(Number),
    );
    expect(fills.length).toBeGreaterThan(10);
    const left = Math.min(...fills.map((f) => f[0]!));
    const trim = /\/TrimBox \[([\d. ]+)\]/.exec(pdf)![1]!.split(" ").map(Number);
    // No module may touch the trim edge.
    expect(left).toBeGreaterThan(trim[0]!);
  });
});

describe("the price line (FUT-997)", () => {
  it("prints the price when the caller supplies one", () => {
    const pdf = build({ stickers: [{ ...STICKER, priceLine: "R$ 8,90" }] });
    expect(pdf).toContain("(R$ 8,90)");
  });

  it("omits it entirely when there is none — a plaquinha is not a shelf label", () => {
    expect(build()).not.toContain("R$");
  });

  it("still fits the code on the smallest sticker with a price", () => {
    // The price takes a line from the QR's share; a negative side would draw
    // nothing at all, silently.
    const pdf = build({ stickers: [{ ...STICKER, priceLine: "R$ 1.234,56" }] });
    const fills = [...pdf.matchAll(/[\d.]+ [\d.]+ ([\d.]+) ([\d.]+) re f/g)];
    expect(fills.length).toBeGreaterThan(10);
    for (const [, width, height] of fills) {
      expect(Number(width)).toBeGreaterThan(0);
      expect(Number(height)).toBeGreaterThan(0);
    }
  });
});

describe("layouts", () => {
  it("gives an individual run one page per sticker", () => {
    const stickers = [STICKER, { ...STICKER, label: "B" }, { ...STICKER, label: "C" }];
    const pdf = build({ stickers });
    expect(/\/Count (\d+)/.exec(pdf)?.[1]).toBe("3");
  });

  it("imposes a sheet run on A4 and paginates when it overflows", () => {
    // 50x70mm inside a 190x277mm usable area with a 4mm gutter: 3 across and
    // 3 down = 9 per page, so 10 needs a second one.
    const nine = Array.from({ length: 9 }, (_, index) => ({ ...STICKER, label: `Item ${index}` }));
    expect(/\/Count (\d+)/.exec(build({ stickers: nine, layout: "sheet" }))?.[1]).toBe("1");
    expect(
      /\/Count (\d+)/.exec(build({ stickers: [...nine, STICKER], layout: "sheet" }))?.[1],
    ).toBe("2");
  });

  it("titles the document with the brand so a job list is readable", () => {
    expect(build()).toContain("(QR do mercado - Bar do Z");
  });
});

describe("the Info dictionary is not the page's encoding", () => {
  it("folds typographic characters to ASCII in the title", () => {
    // Measured: "QR do mercado — folha A4" opened in Chrome's viewer as
    // "QR do mercado Š folha A4". The Info dictionary is PDFDocEncoding, and
    // the cp1252 byte the PAGE renders as an em-dash means something else here.
    const pdf = build({ title: "QR do mercado — folha “A4”", brandName: "" });
    expect(/\/Title \(([^)]*)\)/.exec(pdf)?.[1]).toBe('QR do mercado - folha "A4"');
  });

  it("drops anything above ASCII rather than emitting a wrong byte", () => {
    const pdf = build({ title: "Etiquetas ✚ mercado", brandName: "" });
    const title = /\/Title \(([^)]*)\)/.exec(pdf)?.[1];
    expect(title).toBe("Etiquetas  mercado");
  });

  it("still prints the accented brand correctly on the PAGE", () => {
    // The fold is for the Info dictionary alone; WinAnsi page text keeps its
    // accents, which is the whole reason the two are handled separately.
    expect(build()).toContain("Bar do Z\xE9");
  });
});

describe("pdfDateOf", () => {
  it("formats the only shape an Info dictionary takes", () => {
    expect(pdfDateOf(new Date(2026, 7, 30, 9, 5, 3))).toBe("D:20260830090503");
  });
});
