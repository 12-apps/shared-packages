import type { RasterImage, TicketLine } from "../index";
import { resolveStyle, type ResolvedStyle } from "../style";

/**
 * A laid-out ticket as the bytes a thermal printer speaks.
 *
 * ESC/POS is the lingua franca of receipt printers — Bematech, Epson, Elgin and
 * Daruma all take it — which is why this encoder writes bytes to a socket
 * rather than integrating a vendor SDK per model. The commands used are the
 * small, universally implemented core: initialise, select a code page, align,
 * emphasise, font select, double height and width,
 * reverse, line spacing, raster image, feed, cut.
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
 * Bit 0 selects Font B, bit 3 is emphasis (bold), bit 4 double height and bit 5
 * double width. The legacy emphases come out exactly as they always did —
 * `normal` 0x00, `bold` 0x08, `double` 0x18 — and `double` still never sets the
 * width bit: it halves the columns, and a headline that silently wraps at 24
 * characters on a 48-column layout is worse than one that is merely tall.
 *
 * The two large sizes DO set it, because a sized line is wrapped at its own
 * column count (see `columnsFor`), so the width the printer uses is the width
 * the layout measured. The size table and its reasoning live in `../sizes`.
 */
function modeByte(style: ResolvedStyle): number {
  return (
    (style.font === "B" ? 0x01 : 0) |
    (style.bold ? 0x08 : 0) |
    (style.heightMultiplier === 2 ? 0x10 : 0) |
    (style.widthMultiplier === 2 ? 0x20 : 0)
  );
}

/** `ESC a n` — 0 left, 1 centre. */
const ALIGN = { left: 0, center: 1 } as const;

/**
 * Rows per `GS v 0` command. The command itself allows far more, but a printer
 * buffers a whole command before it prints, and the cheap ones in this class
 * have small buffers; a logo sent as strips of at most 255 rows prints the same
 * and never overruns one.
 */
const RASTER_STRIP_ROWS = 255;

/**
 * `GS v 0` — a 1-bit raster, in strips.
 *
 * `RasterImage.data` is already the command's own format (rows top to bottom,
 * MSB leftmost, 1 = black), so the bytes are copied, not converted. A buffer
 * shorter than `width × height` prints the rows it has rather than throwing:
 * a ticket missing half a logo still carries the order.
 */
function pushRaster(bytes: number[], raster: RasterImage): void {
  const rowBytes = Math.ceil(raster.width / 8);
  if (rowBytes === 0) return;
  const rows = Math.min(raster.height, Math.floor(raster.data.length / rowBytes));
  for (let start = 0; start < rows; start += RASTER_STRIP_ROWS) {
    const count = Math.min(RASTER_STRIP_ROWS, rows - start);
    bytes.push(GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, count & 0xff, count >> 8);
    const strip = raster.data.subarray(start * rowBytes, (start + count) * rowBytes);
    strip.forEach((byte) => bytes.push(byte));
  }
}

/** What the printer currently has set, so a command is sent only on a change. */
interface PrinterState {
  mode: number;
  align: number;
  reverse: boolean;
  /** Line spacing in dots, or `null` for the printer's default. */
  spacing: number | null;
}

function setAlign(bytes: number[], state: PrinterState, align: TicketLine["align"]): void {
  const wanted: number = ALIGN[align] ?? ALIGN.left;
  if (wanted === state.align) return;
  bytes.push(ESC, 0x61, wanted);
  state.align = wanted;
}

function setReverse(bytes: number[], state: PrinterState, reverse: boolean): void {
  if (reverse === state.reverse) return;
  bytes.push(GS, 0x42, reverse ? 1 : 0); // GS B n — white on black
  state.reverse = reverse;
}

/**
 * `ESC 3 n` / `ESC 2` — line spacing.
 *
 * A framed line closes the spacing to the height of its own cell, so the
 * verticals of a box join into one border and a band of several lines is one
 * black block rather than stripes. Everything else keeps the printer's default
 * spacing, which is what the lines around it were designed against.
 */
function setSpacing(bytes: number[], state: PrinterState, spacing: number | null): void {
  if (spacing === state.spacing) return;
  if (spacing === null) bytes.push(ESC, 0x32);
  else bytes.push(ESC, 0x33, spacing);
  state.spacing = spacing;
}

function pushTextLine(bytes: number[], state: PrinterState, line: TicketLine): void {
  const style = resolveStyle(line);
  const mode = modeByte(style);
  if (mode !== state.mode) {
    bytes.push(ESC, 0x21, mode);
    state.mode = mode;
  }
  setAlign(bytes, state, line.align);
  setReverse(bytes, state, line.frame === "band");
  setSpacing(bytes, state, line.frame === undefined ? null : style.cellHeightDots);
  bytes.push(...encodeText(line.text), 0x0a);
}

function pushImageLine(bytes: number[], state: PrinterState, raster: RasterImage, line: TicketLine): void {
  // `GS v 0` honours justification and nothing else, so only alignment and the
  // reverse flag (which would otherwise leak into the next text line) matter.
  setReverse(bytes, state, false);
  setAlign(bytes, state, line.align);
  pushRaster(bytes, raster);
}

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
 *
 * A ticket that uses none of the newer line kinds encodes to exactly the bytes
 * it always did: every command is sent only when its setting changes.
 */
export function encodeTicket(lines: readonly TicketLine[]): Uint8Array {
  const bytes: number[] = [
    ESC, 0x40, // initialise — clears whatever the previous job left set
    ESC, 0x74, 0x02, // select CP850
  ];
  const state: PrinterState = { mode: 0x00, align: ALIGN.left, reverse: false, spacing: null };
  for (const line of lines) {
    if (line.image !== undefined) pushImageLine(bytes, state, line.image, line);
    else pushTextLine(bytes, state, line);
  }
  // Reset before the cut so the NEXT job starts from a known state even if it
  // is written by something that does not initialise.
  setReverse(bytes, state, false);
  setSpacing(bytes, state, null);
  bytes.push(ESC, 0x21, 0x00, ESC, 0x61, ALIGN.left);
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x42, 0x00); // partial cut, feeding to the cutter
  return Uint8Array.from(bytes);
}
