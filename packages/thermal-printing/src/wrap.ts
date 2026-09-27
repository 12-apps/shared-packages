/**
 * How many columns a string takes on paper: its code points, after NFC.
 *
 * Not `.length`, which counts UTF-16 units — an emoji is two of them, and a
 * decomposed "é" (e + combining acute) is two code points that NFC makes one.
 * The ESC/POS encoder writes exactly one byte per code point of NFC text (an
 * unmappable one becomes `?`), so this is the count the printer advances by.
 * A browser may draw an emoji wider than one monospace cell; the paper, which
 * is what the layout is for, does not.
 */
export function textWidth(text: string): number {
  return Array.from(text.normalize("NFC")).length;
}

/** `text` padded with spaces to `width` columns on the right (`end`) or left (`start`). */
export function padTo(text: string, width: number, side: "start" | "end"): string {
  const fill = " ".repeat(Math.max(0, width - textWidth(text)));
  return side === "end" ? text + fill : fill + text;
}

/**
 * Break an over-long word into pieces the roll can hold.
 *
 * The printer would break it anyway, at a column this code did not choose — so
 * a 40-character product name is split here, where the layout can still put the
 * hanging indent in the right place.
 */
function chunk(word: string, limit: number): string[] {
  const chars = [...word];
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += limit) parts.push(chars.slice(i, i + limit).join(""));
  return parts;
}

/** The text as words that each fit, so the wrapper below never has to break one. */
function fittingWords(text: string, limit: number): string[] {
  return text
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .flatMap((word) => (textWidth(word) <= limit ? [word] : chunk(word, limit)));
}

/**
 * Break text to the paper's width, indenting every line after the first.
 *
 * The hanging indent is what keeps a wrapped item readable as ONE thing:
 *
 * ```
 * 2x Chup Chup Gourmet - Maracuja com
 *    Nutella
 * ```
 *
 * reads as a single line of food at a glance, while a flush-left continuation
 * reads as a second item — which on a kitchen pass is a plate too many.
 */
export function wrap(text: string, columns: number, indent = 0): string[] {
  // An indent that leaves no room would ask `chunk` for zero-width pieces,
  // which never finishes; one column of text is the least a line can carry.
  const hang = Math.max(0, Math.min(indent, columns - 1));
  const pad = " ".repeat(hang);
  const lines: string[] = [];
  for (const word of fittingWords(text.normalize("NFC"), columns - hang)) {
    const current = lines[lines.length - 1];
    if (current === undefined) lines.push(word);
    else if (textWidth(current) + 1 + textWidth(word) > columns) lines.push(pad + word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
}
