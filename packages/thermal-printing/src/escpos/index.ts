import type { TicketLine } from "../index";

/**
 * A laid-out ticket as the bytes a thermal printer speaks.
 *
 * ESC/POS is the lingua franca of receipt printers — Bematech, Epson, Elgin and
 * Daruma all take it — which is why this encoder writes bytes to a socket
 * rather than integrating a vendor SDK per model. The commands used are the
 * small, universally implemented core: initialise, select a code page, align,
 * emphasise, double height, feed, cut.
 *
 * ## The code page is the part that is easy to get wrong
 *
 * A printer does not speak UTF-8. It holds a byte-per-character table and
 * prints whatever glyph sits at each byte, so sending an accented word as UTF-8
 * puts two characters where one belongs — reliably, on every printer, in a way
 * that looks like a font problem and is not.
 *
 * So the encoder selects **CP850** (`ESC t 2`) and maps the Latin-script
 * characters a ticket is likely to carry. CP850 rather than the more common
 * CP437 because 437 has no ã, õ or Ç, which between them appear in most
 * Portuguese and Spanish text; CP850 rather than CP858 because the two differ
 * only in the euro sign, and 850 is the one every printer in this class ships
 * with.
 *
 * Anything outside the table degrades in two steps — strip the diacritic, then
 * `?` — rather than throwing. A ticket with one wrong character is still a
 * ticket somebody can work from; a thrown error is an order that never reached
 * the person who had to make it.
 */


const ESC = 0x1b;
const GS = 0x1d;

/** CP850 for every character a Latin-script ticket is likely to carry. */
const CP850: Readonly<Record<string, number>> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "å": 0x86, "ç": 0x87,
  "ê": 0x88, "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c, "ì": 0x8d, "Ä": 0x8e, "Å": 0x8f,
  "É": 0x90, "æ": 0x91, "Æ": 0x92, "ô": 0x93, "ö": 0x94, "ò": 0x95, "û": 0x96, "ù": 0x97,
  "ÿ": 0x98, "Ö": 0x99, "Ü": 0x9a, "ø": 0x9b, "£": 0x9c, "Ø": 0x9d, "×": 0x9e,
  "á": 0xa0, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ª": 0xa6, "º": 0xa7,
  "¿": 0xa8, "®": 0xa9, "½": 0xab, "¼": 0xac, "¡": 0xad, "«": 0xae, "»": 0xaf,
  "Á": 0xb5, "Â": 0xb6, "À": 0xb7, "©": 0xb8, "¢": 0xbd, "¥": 0xbe,
  "ã": 0xc6, "Ã": 0xc7, "¤": 0xcf,
  "ð": 0xd0, "Ð": 0xd1, "Ê": 0xd2, "Ë": 0xd3, "È": 0xd4, "ı": 0xd5, "Í": 0xd6, "Î": 0xd7,
  "Ï": 0xd8, "Ì": 0xde,
  "Ó": 0xe0, "ß": 0xe1, "Ô": 0xe2, "Ò": 0xe3, "õ": 0xe4, "Õ": 0xe5, "µ": 0xe6, "þ": 0xe7,
  "Þ": 0xe8, "Ú": 0xe9, "Û": 0xea, "Ù": 0xeb, "ý": 0xec, "Ý": 0xed, "¯": 0xee, "´": 0xef,
  "±": 0xf1, "¾": 0xf3, "¶": 0xf4, "§": 0xf5, "÷": 0xf6, "¸": 0xf7, "°": 0xf8, "¨": 0xf9,
  "·": 0xfa, "¹": 0xfb, "³": 0xfc, "²": 0xfd,
};

/**
 * The last resort before `?`: the character without its accent.
 *
 * "Maracuja" is a word somebody can still read. A `?` in the middle of one is
 * not, so the diacritic strip runs first and only genuinely foreign glyphs
 * (an emoji in a store-authored name, say) fall through to it.
 */
function asciiFold(char: string): string {
  return char.normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}

/** One character as one byte of CP850. */
function encodeChar(char: string): number {
  const code = char.codePointAt(0) ?? 0x3f;
  if (code < 0x80) return code;
  const mapped = CP850[char];
  if (mapped !== undefined) return mapped;
  const folded = asciiFold(char);
  const foldedCode = folded.length === 1 ? (folded.codePointAt(0) ?? 0x3f) : 0x3f;
  return foldedCode < 0x80 ? foldedCode : 0x3f;
}

function encodeText(text: string): number[] {
  return [...text].map(encodeChar);
}

/**
 * `ESC ! n` — the character-mode byte.
 *
 * Bit 3 is emphasis (bold) and bit 4 is double height. Double WIDTH (bit 5) is
 * deliberately unused: it halves the columns, and a headline that silently
 * wraps at 24 characters on a 48-column layout is worse than one that is merely
 * tall.
 */
const MODE = { normal: 0x00, bold: 0x08, double: 0x18 } as const;

/** `ESC a n` — 0 left, 1 centre. */
const ALIGN = { left: 0, center: 1 } as const;

/**
 * Encode a laid-out ticket, ready to write to a socket.
 *
 * Takes LINES and not a ticket: the paper width was already spent on the
 * layout, so an encoder that took it again would be a second place the roll
 * size could be got wrong.
 *
 * Ends with a feed and a partial cut. The feed is not decoration: the cutter
 * sits a couple of centimetres above the print head, so without it the cut
 * lands in the middle of the last lines somebody needs to read.
 */
export function encodeTicket(lines: readonly TicketLine[]): Uint8Array {
  const bytes: number[] = [
    ESC, 0x40, // initialise — clears whatever the previous job left set
    ESC, 0x74, 0x02, // select CP850
  ];
  let mode: number = MODE.normal;
  let align: number = ALIGN.left;
  for (const line of lines) {
    const wanted: number = MODE[line.emphasis] ?? MODE.normal;
    if (wanted !== mode) {
      bytes.push(ESC, 0x21, wanted);
      mode = wanted;
    }
    const wantedAlign: number = ALIGN[line.align] ?? ALIGN.left;
    if (wantedAlign !== align) {
      bytes.push(ESC, 0x61, wantedAlign);
      align = wantedAlign;
    }
    bytes.push(...encodeText(line.text), 0x0a);
  }
  // Reset before the cut so the NEXT job starts from a known state even if it
  // is written by something that does not initialise.
  bytes.push(ESC, 0x21, MODE.normal, ESC, 0x61, ALIGN.left);
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x42, 0x00); // partial cut, feeding to the cutter
  return Uint8Array.from(bytes);
}
