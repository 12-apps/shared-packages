import { readFileSync } from 'node:fs';

/**
 * The one typeface a PDF is set in: Noto Sans, regular and bold (SIL Open Font
 * License, `./fonts/OFL.txt`), read once from the package and embedded as a
 * SUBSET per document, so nothing is fetched and a file carries only the
 * glyphs it uses.
 */
interface FontFiles {
  regular: Uint8Array;
  bold: Uint8Array;
}

let cached: FontFiles | undefined;

function read(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fonts/${name}`, import.meta.url)));
}

export function fontFiles(): FontFiles {
  cached ??= { regular: read('NotoSans-Regular.ttf'), bold: read('NotoSans-Bold.ttf') };
  return cached;
}
