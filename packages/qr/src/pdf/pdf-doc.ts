/**
 * A very small PDF writer, for artwork a print shop will accept.
 *
 * **Why hand-written rather than a library.** What a gráfica reads out of a
 * file is a short list: the page boxes (`TrimBox` / `BleedBox` / `MediaBox`),
 * whether the marks sit outside the trim, and what colour the black is. All
 * three are one line of PDF each, and a general-purpose library would put an
 * abstraction between this file and the exact bytes while adding ~400KB to a
 * bundle that ships to every admin. The QR itself needs no drawing model at
 * all: it is filled rectangles.
 *
 * Deliberately NOT a general PDF library. It writes what a sticker sheet needs
 * — filled rectangles, stroked lines, and base-14 text — and nothing else.
 * Anything beyond that is a reason to reach for a real library, not to grow
 * this one.
 *
 * The whole document is assembled as a string in which every character is
 * below U+0100, then widened to bytes at the end. That is what lets the
 * cross-reference table be built from string offsets: for such a string, one
 * character IS one byte, and an xref that disagrees with the file by even one
 * byte is a file no reader will open.
 */

/** PDF user space is 1/72", so a millimetre is this many units. */
const PT_PER_MM = 72 / 25.4;

export function mm(value: number): number {
  return value * PT_PER_MM;
}

/** Numbers in a content stream: fixed precision, never exponent notation. */
export function num(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * A PDF text string, escaped, and reduced to bytes a base-14 font can show.
 *
 * The fonts are used with `WinAnsiEncoding`, which agrees with Latin-1 across
 * the whole range Portuguese needs (á ã ç é ê í ó õ ú à), so a code point
 * under 256 is already its own byte. Anything above that has no glyph in this
 * encoding and would otherwise emit a character the reader renders as noise —
 * it is dropped, because a printed label is not the place to silently invent a
 * symbol.
 */
function pdfString(value: string): string {
  let out = "";
  for (const char of value) {
    const mapped = WIN_ANSI_HIGH[char] ?? char;
    const code = mapped.codePointAt(0) ?? 0;
    if (code > 255) continue;
    if (mapped === "(" || mapped === ")" || mapped === "\\") out += `\\${mapped}`;
    else if (code < 32) out += " ";
    else out += mapped;
  }
  return `(${out})`;
}

/**
 * The handful of places WinAnsi is cp1252 rather than Latin-1.
 *
 * These code points sit above 255 and would otherwise be dropped — which is
 * how a store called "Bar do Zé — Centro" prints with a hole in its name. The
 * bytes exist in the encoding; they just are not where Unicode puts them.
 */
const WIN_ANSI_HIGH: Record<string, string> = {
  "€": "\x80", // €
  "…": "\x85", // …
  "‘": "\x91", // ‘
  "’": "\x92", // ’
  "“": "\x93", // “
  "”": "\x94", // ”
  "•": "\x95", // •
  "–": "\x96", // –
  "—": "\x97", // —
};

/**
 * A string for the Info dictionary, folded to ASCII first.
 *
 * The page text is WinAnsi, and {@link pdfString} maps the cp1252 range into it
 * so an em-dash or a curly quote prints correctly. The Info dictionary is
 * **PDFDocEncoding**, which is a different table in exactly that range — so the
 * same byte a page renders as "—" a reader shows in its title bar as "Š".
 *
 * Measured: a document titled "QR do mercado — folha A4" opened in Chrome's
 * viewer as "QR do mercado Š folha A4". Nothing about the artwork is wrong and
 * nothing fails; the only symptom is a mangled name in a tab and in a print
 * shop's job list.
 *
 * So the typographic characters are folded to their ASCII equivalents rather
 * than mapped, and anything else above 127 is dropped. A title is a label, not
 * artwork: legible beats faithful.
 */
const ASCII_FOLD: Record<string, string> = {
  "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
  "…": "...", "•": "-", "€": "EUR",
};

function infoString(value: string): string {
  let out = "";
  for (const char of value) {
    const folded = ASCII_FOLD[char] ?? char;
    for (const piece of folded) {
      if ((piece.codePointAt(0) ?? 0) <= 127) out += piece;
    }
  }
  return pdfString(out);
}

/** The three boxes a print shop reads, in points. */
export interface PageBoxes {
  /** The whole sheet, including bleed and room for the marks. */
  media: [number, number, number, number];
  /** Where the blade goes. */
  trim: [number, number, number, number];
  /** How far the artwork runs past the blade. */
  bleed: [number, number, number, number];
}

export interface PdfPage {
  boxes: PageBoxes;
  /** Content-stream operators, already assembled. */
  content: string;
}

interface PdfMeta {
  title: string;
  /** Stamped so a re-print years later can be traced to what produced it. */
  creator: string;
  /** `D:YYYYMMDDHHmmSS` — passed in, never read off the clock here. */
  date: string;
}

const box = (values: [number, number, number, number]): string =>
  `[${values.map(num).join(" ")}]`;

/** The two base-14 faces this document uses. Neither is embedded — every
 * RIP has them, and embedding would put a font licence in the artwork. */
const FONTS: [string, string][] = [
  ["F1", "Helvetica"],
  ["F2", "Helvetica-Bold"],
];

function pageObject(page: PdfPage, contentRef: number, fontRefs: number[]): string {
  const resources = FONTS.map(
    ([name], index) => `/${name} ${fontRefs[index] ?? 0} 0 R`,
  ).join(" ");
  return [
    "<</Type/Page/Parent 2 0 R",
    `/MediaBox ${box(page.boxes.media)}`,
    `/TrimBox ${box(page.boxes.trim)}`,
    `/BleedBox ${box(page.boxes.bleed)}`,
    `/Resources<</Font<<${resources}>>/ProcSet[/PDF/Text]>>`,
    `/Contents ${contentRef} 0 R>>`,
  ].join("");
}

/** Every object in order, so the writer below only has to count bytes. */
function objectsFor(pages: PdfPage[], meta: PdfMeta): string[] {
  // 1 catalog, 2 pages, then per page [page, content], then the fonts, then info.
  const first = 3;
  const pageRefs = pages.map((_, index) => first + index * 2);
  const fontRefs = FONTS.map((_, index) => first + pages.length * 2 + index);
  const objects: string[] = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}]/Count ${pages.length}>>`,
  ];
  pages.forEach((page, index) => {
    objects.push(pageObject(page, (pageRefs[index] ?? 0) + 1, fontRefs));
    objects.push(`<</Length ${page.content.length}>>\nstream\n${page.content}\nendstream`);
  });
  FONTS.forEach(([, base]) => {
    objects.push(`<</Type/Font/Subtype/Type1/BaseFont/${base}/Encoding/WinAnsiEncoding>>`);
  });
  objects.push(
    `<</Title ${infoString(meta.title)}/Creator ${infoString(meta.creator)}` +
      `/Producer ${infoString(meta.creator)}/CreationDate ${infoString(meta.date)}>>`,
  );
  return objects;
}

/**
 * Assemble the document.
 *
 * The `%âãÏÓ` comment on line two is not decoration: it is the convention that
 * marks a file as binary, and tools that transfer PDFs in text mode use it to
 * decide not to mangle the line endings.
 */
export function buildPdf(pages: PdfPage[], meta: PdfMeta): Uint8Array<ArrayBuffer> {
  const objects = objectsFor(pages, meta);
  let file = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  file += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R/Info ${objects.length} 0 R>>\n`;
  file += `startxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let index = 0; index < file.length; index += 1) {
    bytes[index] = file.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/**
 * Pure K black, in CMYK.
 *
 * The single most important operator in this file. A QR built from rich black
 * (C+M+Y+K) is printed by four plates, and any misregistration between them
 * fringes every one of the code's edges — on artwork whose entire job is to be
 * read by a camera in bad light. One plate cannot misregister with itself.
 */
export const FILL_BLACK = "0 0 0 1 k";
export const STROKE_BLACK = "0 0 0 1 K";

export function rect(x: number, y: number, width: number, height: number): string {
  return `${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`;
}

export function line(x1: number, y1: number, x2: number, y2: number): string {
  return `${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`;
}

interface TextOptions {
  /** `F1` regular, `F2` bold. */
  font?: "F1" | "F2";
  size: number;
  /** Centre the string on `x` using the font's own widths. */
  center?: boolean;
}

/**
 * Helvetica's advance widths, in 1/1000 em — enough of them to centre a line.
 *
 * Centring needs the string's width, and without embedding a font there is
 * nowhere to read it from at runtime. The alternative is to left-align
 * everything, which on a sticker means the label drifting off centre by
 * however long it happens to be.
 */
const WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  "{": 334, "|": 260, "}": 334, "~": 584,
};

/** Digits and most caps/lowercase, without listing all 52 by hand. */
function glyphWidth(char: string): number {
  const known = WIDTHS[char];
  if (known !== undefined) return known;
  if (char >= "0" && char <= "9") return 556;
  if (char >= "A" && char <= "Z") return "IJ".includes(char) ? 278 : 700;
  if (char >= "a" && char <= "z") return "ijlt".includes(char) ? 250 : 545;
  // Accented letters carry their base letter's advance in Helvetica.
  return 545;
}

function textWidth(value: string, size: number): number {
  let total = 0;
  for (const char of value) total += glyphWidth(char);
  return (total / 1000) * size;
}

export function text(value: string, x: number, y: number, options: TextOptions): string {
  const font = options.font ?? "F1";
  const left = options.center ? x - textWidth(value, options.size) / 2 : x;
  return [
    "BT",
    `/${font} ${num(options.size)} Tf`,
    `${num(left)} ${num(y)} Td`,
    `${pdfString(value)} Tj`,
    "ET",
  ].join("\n");
}
