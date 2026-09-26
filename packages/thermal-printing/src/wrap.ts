/**
 * Break an over-long word into pieces the roll can hold.
 *
 * The printer would break it anyway, at a column this code did not choose — so
 * a 40-character product name is split here, where the layout can still put the
 * hanging indent in the right place.
 */
function chunk(word: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = word;
  while (rest.length > 0) {
    parts.push(rest.slice(0, limit));
    rest = rest.slice(limit);
  }
  return parts;
}

/** The text as words that each fit, so the wrapper below never has to break one. */
function fittingWords(text: string, limit: number): string[] {
  return text
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .flatMap((word) => (word.length <= limit ? [word] : chunk(word, limit)));
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
  for (const word of fittingWords(text, columns - hang)) {
    const current = lines[lines.length - 1];
    if (current === undefined) lines.push(word);
    else if (current.length + 1 + word.length > columns) lines.push(pad + word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
}
