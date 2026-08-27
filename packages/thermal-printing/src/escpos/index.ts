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

/**
 * CP850's upper half (0x80-0xFF) as Unicode code points, in byte order.
 *
 * Code points rather than character literals, and that is not a workaround —
 * a code page IS a mapping between byte values and code points, so this is the
 * table in its own terms. Written as the full contiguous range rather than a
 * hand-picked subset, because the range is what the standard defines and a
 * subset is a set of holes nobody notices until a name falls into one.
 *
 * The trailing comment on each row is what that row decodes to, which is the
 * half a reader actually checks.
 */
const CP850_UPPER: readonly number[] = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7, // 0x80  Çüéâäàåç
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5, // 0x88  êëèïîìÄÅ
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9, // 0x90  ÉæÆôöòûù
  0x00ff, 0x00d6, 0x00dc, 0x00f8, 0x00a3, 0x00d8, 0x00d7, 0x0192, // 0x98  ÿÖÜø£Ø×ƒ
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba, // 0xa0  áíóúñÑªº
  0x00bf, 0x00ae, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb, // 0xa8  ¿®¬½¼¡«»
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x00c1, 0x00c2, 0x00c0, // 0xb0  ░▒▓│┤ÁÂÀ
  0x00a9, 0x2563, 0x2551, 0x2557, 0x255d, 0x00a2, 0x00a5, 0x2510, // 0xb8  ©╣║╗╝¢¥┐
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x00e3, 0x00c3, // 0xc0  └┴┬├─┼ãÃ
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x00a4, // 0xc8  ╚╔╩╦╠═╬¤
  0x00f0, 0x00d0, 0x00ca, 0x00cb, 0x00c8, 0x0131, 0x00cd, 0x00ce, // 0xd0  ðÐÊËÈıÍÎ
  0x00cf, 0x2518, 0x250c, 0x2588, 0x2584, 0x00a6, 0x00cc, 0x2580, // 0xd8  Ï┘┌█▄¦Ì▀
  0x00d3, 0x00df, 0x00d4, 0x00d2, 0x00f5, 0x00d5, 0x00b5, 0x00fe, // 0xe0  ÓßÔÒõÕµþ
  0x00de, 0x00da, 0x00db, 0x00d9, 0x00fd, 0x00dd, 0x00af, 0x00b4, // 0xe8  ÞÚÛÙýÝ¯´
  0x00ad, 0x00b1, 0x2017, 0x00be, 0x00b6, 0x00a7, 0x00f7, 0x00b8, // 0xf0  ­±‗¾¶§÷¸
  0x00b0, 0x00a8, 0x00b7, 0x00b9, 0x00b3, 0x00b2, 0x25a0, 0x00a0, // 0xf8  °¨·¹³²■␣
];

/** Code point to byte, built once. */
const CP850 = new Map(CP850_UPPER.map((codePoint, index) => [codePoint, 0x80 + index]));

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
  const mapped = CP850.get(code);
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
