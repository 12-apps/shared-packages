import { columnsFor, printableDotsFor, type RasterImage, type TicketLine } from "../index";
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
 * in a monospace column of exactly the same width. What the browser adds is
 * only what a browser is for: real accents with no code page, and the operating
 * system's print dialog.
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

/** The legacy character-mode styles, matching what ESC/POS does with the same line. */
const STYLE: Readonly<Record<TicketLine["emphasis"], string>> = {
  normal: "",
  bold: "font-weight:700",
  // Double HEIGHT only, exactly as the ESC/POS encoder does it — a doubled
  // width would rewrap the headline at half the columns the layout used.
  double: "font-weight:700;font-size:2em;line-height:1.1",
};

/**
 * A sized line's font size, relative to the body's Font A column.
 *
 * The body is exactly `columnsFor(paperWidthMm)` characters wide, so a size
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
 * A picture line, at the width it will have on paper.
 *
 * The body is `columnsFor(paperWidthMm)` characters wide and stands for the
 * printable width, `printableDotsFor(paperWidthMm)` dots — 12 dots per
 * character on either roll — so a raster N dots wide is N / 12 characters wide
 * here, whatever the screen's pixel density. `pixelated` keeps the dots square
 * when that scales up, which is what makes this an honest preview of the paper.
 */
function imageLineHtml(line: TicketLine, raster: RasterImage, paperWidthMm: number): string {
  const dotsPerColumn = printableDotsFor(paperWidthMm) / columnsFor(paperWidthMm);
  const width = Number((raster.width / dotsPerColumn).toFixed(4));
  const margin = line.align === "center" ? "0 auto" : "0";
  return (
    `<div><img alt="" src="${rasterToDataUri(raster)}" ` +
    `style="display:block;margin:${margin};width:${width}ch;image-rendering:pixelated"></div>`
  );
}

/**
 * Render a ticket as a standalone document.
 *
 * `ch` units rather than millimetres: the layout already decided the ticket is
 * N columns wide, so the page is N characters wide by construction and a
 * printer driver's own margins cannot rewrap it. `@page { margin: 0 }` is what
 * stops the driver adding an inch of letter-paper margin to a receipt roll.
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
  const columns = columnsFor(paperWidthMm);
  const body = lines
    .map((line) =>
      line.image === undefined
        ? textLineHtml(line, paperWidthMm)
        : imageLineHtml(line, line.image, paperWidthMm),
    )
    .join("");
  return [
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">`,
    "<style>",
    "@page{margin:0}",
    `body{margin:0;font-family:'Courier New',monospace;font-size:12px;line-height:1.25;width:${columns}ch;white-space:pre}`,
    "</style></head><body>",
    body,
    "</body></html>",
  ].join("");
}
