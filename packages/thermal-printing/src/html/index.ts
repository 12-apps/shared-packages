import { columnsFor, printableDotsFor, type RasterImage, type TicketLine } from "../index";
import { DOTS_PER_MM } from "../sizes";
import { rasterToDataUri } from "./bitmap";

export { rasterToDataUri } from "./bitmap";

/**
 * The same laid-out ticket as markup, for a printer on a CABLE.
 *
 * A USB printer has no address, so nothing server-side can reach it. What CAN
 * reach it is a browser running on the machine it is plugged into: that
 * computer prints through the operating system's own driver, the same way it
 * would print anything else. So a local job travels as this document and a tab
 * prints it.
 *
 * ## Why it is still built from `TicketLine[]`
 *
 * It would be easier to write a `<table>` here and let the browser lay it out.
 * That is exactly the divergence this module exists to refuse: a store that
 * swapped a USB printer for a network one would then get a differently
 * organised ticket, and every later change to the layout would have to be made
 * twice and verified on two kinds of hardware.
 *
 * So the fixed-width layout stays authoritative for BOTH, and this renders it
 * in a monospace column of exactly the same width — the printable width of the
 * roll, never more. What the browser adds is only what a browser is for: real
 * accents with no code page, and the operating system's print dialog.
 */


const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Escape for HTML text content.
 *
 * An item name is store-authored and reaches this document unchanged, so it is
 * untrusted markup: "Refri <2L>" must print as itself rather than open a tag,
 * and an item named after a script tag must never become one in the tab that
 * prints it.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ENTITIES[char] ?? char);
}

/**
 * The legacy character-mode styles, matching what ESC/POS does with the same line.
 *
 * `double` is double HEIGHT only, exactly as the ESC/POS encoder does it. A
 * `font-size:2em` would double the width too and push a 48-column line half off
 * the roll, so the glyphs are stretched vertically and the line reserves the
 * second line's height below it.
 */
const STYLE: Readonly<Record<TicketLine["emphasis"], string>> = {
  normal: "",
  bold: "font-weight:700",
  double: "font-weight:700;transform:scaleY(2);transform-origin:top;margin-bottom:1.25em",
};

/**
 * A sized line's font size, relative to the body's Font A column.
 *
 * The body holds exactly `columnsFor(paperWidthMm)` characters, so a size
 * whose column count is N must set its glyphs at (body columns / N) of the body
 * size to fit N of them in the same width. That is the whole mapping: the page
 * reproduces the printer's column counts, and the ratio between sizes follows —
 * `small` 0.75em, `large` 1.5em and `xlarge` 2em on an 80 mm roll.
 */
function sizeStyle(line: TicketLine, paperWidthMm: number): string {
  if (line.size === undefined) return STYLE[line.emphasis] ?? "";
  const scale = columnsFor(paperWidthMm) / columnsFor(paperWidthMm, line.size);
  const parts = scale === 1 ? [] : [`font-size:${Number(scale.toFixed(4))}em`];
  if (line.emphasis === "bold" || line.emphasis === "double") parts.push("font-weight:700");
  return parts.join(";");
}

/**
 * The frame's styles. `print-color-adjust:exact` is not optional on the band:
 * without it a browser drops background colours when printing, and the band
 * comes out as white text on white paper — nothing at all.
 */
const FRAME_STYLE: Readonly<Record<NonNullable<TicketLine["frame"]>, string>> = {
  band: "background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact",
  box: "line-height:1",
};

function textLineHtml(line: TicketLine, paperWidthMm: number): string {
  const style = [
    sizeStyle(line, paperWidthMm),
    line.frame === undefined ? "" : (FRAME_STYLE[line.frame] ?? ""),
    line.align === "center" ? "text-align:center" : "",
  ]
    .filter((part) => part.length > 0)
    .join(";");
  const attr = style.length > 0 ? ` style="${style}"` : "";
  // A blank line still has to occupy one, hence the non-breaking space.
  const text = line.text.length === 0 ? "&nbsp;" : escapeHtml(line.text.normalize("NFC"));
  return `<div${attr}>${text}</div>`;
}

/**
 * A picture line, at exactly one image pixel per printer dot.
 *
 * A raster N dots wide is N / 8 mm wide on paper (203 dpi), so that is its
 * width here: the print path then maps each pixel onto one dot, with no
 * fractional scale for a driver to round into missing rows. `pixelated` keeps
 * the dots square and unsmoothed — a thermal head has no grey to smooth into —
 * and `max-width` keeps a raster wider than the roll inside it rather than off
 * its edge.
 */
function imageLineHtml(line: TicketLine, raster: RasterImage): string {
  const width = Number((raster.width / DOTS_PER_MM).toFixed(3));
  const margin = line.align === "center" ? "0 auto" : "0";
  return (
    `<div><img alt="" src="${rasterToDataUri(raster)}" ` +
    `style="display:block;margin:${margin};width:${width}mm;max-width:100%;height:auto;image-rendering:pixelated"></div>`
  );
}

/**
 * The advance of one monospace glyph, in em. Courier New, Liberation Mono and
 * Cousine are exactly 0.6; DejaVu Sans Mono and Menlo are 0.602.
 */
const GLYPH_ADVANCE_EM = 0.6;

/**
 * The share of the printable width a full line may take. The 2 % left over
 * absorbs a fallback font slightly wider than 0.6 em and the text stroke below,
 * so the last column never reaches the edge the head cannot print.
 */
const FILL = 0.98;

/**
 * How much every glyph is thickened, in millimetres — about one printer dot.
 *
 * A thermal head prints black or nothing. A regular-weight Courier stem at this
 * size is under one dot wide, so the renderer draws it as grey anti-aliasing and
 * the driver dithers the grey into a faded, broken line. Stroking the outline in
 * the text's own colour widens every stem past a dot, so it prints solid; bold
 * stays visibly heavier because it starts heavier.
 */
const STROKE_MM = 0.12;

/**
 * The document's page style: the body is exactly the roll's PRINTABLE width —
 * 72 mm of an 80 mm roll, 48 mm of a 58 mm one — and the type is sized so the
 * layout's column count fills it.
 *
 * Millimetres, not `ch` at a pixel size. `48ch` of 12 px Courier is 91 mm, and a
 * print path either shrinks that to the page or clips what the head cannot
 * reach: on a Bematech MP-4200 the left edge printed whole and the amounts at
 * the right edge went missing. Sized from the printable width, one column is
 * 1.5 mm — the printer's own Font A cell — and the last one ends where the
 * head does.
 *
 * Pure black on white, set rather than inherited: a thermal head has no grey.
 */
function pageStyle(paperWidthMm: number): string {
  const printableMm = printableDotsFor(paperWidthMm) / DOTS_PER_MM;
  const fontMm = Number(((printableMm / (columnsFor(paperWidthMm) * GLYPH_ADVANCE_EM)) * FILL).toFixed(3));
  return [
    "@page{margin:0}",
    "html{background:#fff}",
    `body{margin:0;padding:0;width:${printableMm}mm;font-family:'Courier New','Liberation Mono',Cousine,monospace;` +
      `font-size:${fontMm}mm;line-height:1.25;white-space:pre;color:#000;background:#fff;` +
      `-webkit-text-stroke-width:${STROKE_MM}mm;-webkit-text-stroke-color:currentColor;` +
      "-webkit-print-color-adjust:exact;print-color-adjust:exact}",
  ].join("");
}

/**
 * Render a ticket as a standalone document.
 *
 * The layout already decided the ticket is N columns wide; the page is the
 * printable width and the type fills it with exactly N (see {@link pageStyle}).
 * `@page { margin: 0 }` is what stops the driver adding an inch of
 * letter-paper margin to a receipt roll.
 *
 * `lang` is the document's language tag. It buys nothing visual on a monospace
 * roll, but it is what a screen reader and the browser's own hyphenation read,
 * and a package that hardcoded one would be asserting something about the host
 * it cannot know.
 */
export function renderTicketHtml(
  lines: readonly TicketLine[],
  paperWidthMm: number,
  lang = "en",
): string {
  const body = lines
    .map((line) =>
      line.image === undefined ? textLineHtml(line, paperWidthMm) : imageLineHtml(line, line.image),
    )
    .join("");
  return [
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">`,
    `<style>${pageStyle(paperWidthMm)}</style></head><body>`,
    body,
    "</body></html>",
  ].join("");
}
