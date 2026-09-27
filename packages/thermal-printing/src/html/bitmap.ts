import type { RasterImage } from "../model";
import { DOTS_PER_MM } from "../sizes";

/**
 * A 1-bit raster as a `data:` URI, with no canvas and no DOM.
 *
 * The format is BMP, 1 bit per pixel, and that is chosen rather than PNG for
 * what it does not need: PNG requires deflate, which in a browser means a
 * canvas or a compression stream and in Node means `node:zlib` — and this
 * module has to build the same string in both. A monochrome BMP is a 62-byte
 * header and the rows, and every browser (and Electron's print window) decodes
 * it. It is larger than a PNG would be; a full-width 80 mm logo 200 dots tall
 * is about 20 kB of base64, which a print document does not notice.
 *
 * The palette puts white at index 0 and black at index 1, so a set bit is a
 * black dot exactly as it is in `RasterImage.data` and the bits are copied
 * as they are. Only the row order (BMP stores bottom-up) and the 4-byte row
 * padding differ.
 */
export function rasterToDataUri(raster: RasterImage): string {
  return `data:image/bmp;base64,${toBase64(encodeBmp(raster))}`;
}

const HEADER_BYTES = 14 + 40 + 8;

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function writeHeader(out: Uint8Array, width: number, height: number, pixelBytes: number): void {
  const pixelsPerMetre = DOTS_PER_MM * 1000;
  out[0] = 0x42; // B
  out[1] = 0x4d; // M
  writeU32(out, 2, out.length);
  writeU32(out, 10, HEADER_BYTES);
  writeU32(out, 14, 40); // BITMAPINFOHEADER
  writeU32(out, 18, width);
  writeU32(out, 22, height); // positive: rows stored bottom-up
  out[26] = 1; // planes
  out[28] = 1; // bits per pixel
  writeU32(out, 34, pixelBytes);
  writeU32(out, 38, pixelsPerMetre);
  writeU32(out, 42, pixelsPerMetre);
  writeU32(out, 46, 2); // colours used
  writeU32(out, 50, 2); // colours important
  // Palette (B, G, R, reserved): index 0 white, index 1 black.
  out.set([0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00], 54);
}

function encodeBmp(raster: RasterImage): Uint8Array {
  const rowBytes = Math.ceil(raster.width / 8);
  const rows = rowBytes === 0 ? 0 : Math.min(raster.height, Math.floor(raster.data.length / rowBytes));
  const stride = Math.ceil(rowBytes / 4) * 4;
  const out = new Uint8Array(HEADER_BYTES + stride * rows);
  writeHeader(out, raster.width, rows, stride * rows);
  for (let y = 0; y < rows; y += 1) {
    const source = raster.data.subarray(y * rowBytes, (y + 1) * rowBytes);
    out.set(source, HEADER_BYTES + (rows - 1 - y) * stride);
  }
  return out;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 without `btoa` or `Buffer`, so the one function runs in a browser, in
 * Node and in a worker with neither global guaranteed.
 */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : "=";
  }
  return out;
}
