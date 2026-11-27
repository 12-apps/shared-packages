import type { ScaleParser, ScaleProfile, ScaleReading } from "./types";

const START = "\x08\x02\x03\x03\x02\x03\x01\x02\x00\x14";
const END = "\x03\x09\x02\x01\x03";
const MAX_FRAME_LENGTH = 256;
const RECORD = /TARA:\s*(\d+\.\d{3})kg\s+PESO L:\s*(\d+\.\d{3})kg\s+R\$\/kg:\s*\d+\.\d{2}\s+TOTAL R\$:\s*\d+\.\d{2}\d{12}$/;

function decodeRecord(frame: string): ScaleReading | undefined {
  const match = RECORD.exec(frame.slice(START.length, -END.length));
  const tare = match?.[1];
  const net = match?.[2];
  if (tare === undefined || net === undefined) return;
  return {
    netGrams: Number(net.replace(".", "")),
    tareGrams: Number(tare.replace(".", "")),
    stable: "inferred",
    raw: Uint8Array.from(frame, (character) => character.charCodeAt(0)),
  };
}

export function createUranoParser(): ScaleParser {
  let pending = "";
  return {
    push(bytes) {
      for (const byte of bytes) pending += String.fromCharCode(byte);
      const readings: ScaleReading[] = [];
      while (pending.length >= START.length) {
        const start = pending.indexOf(START);
        if (start < 0) {
          pending = pending.slice(1 - START.length);
          break;
        }
        pending = pending.slice(start);
        const end = pending.indexOf(END, START.length);
        const nextStart = pending.indexOf(START, START.length);
        if (nextStart >= 0 && (end < 0 || nextStart < end)) {
          pending = pending.slice(nextStart);
          continue;
        }
        if (end < 0) {
          if (pending.length > MAX_FRAME_LENGTH) pending = pending.slice(1 - START.length);
          break;
        }
        const consumed = end + END.length;
        if (consumed <= MAX_FRAME_LENGTH) {
          const reading = decodeRecord(pending.slice(0, consumed));
          if (reading) readings.push(reading);
        }
        pending = pending.slice(consumed);
      }
      return readings;
    },
  };
}

export const uranoPopLight: ScaleProfile = {
  id: "urano-pop-light",
  label: "Urano US 31/2 POP Light",
  serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", dtr: true, rts: true },
  request: { kind: "poll", bytes: Uint8Array.of(5), intervalMs: 500 },
  silence: "moving-or-invalid",
  usbHints: [{ vendorId: 0x1a86, productId: 0x7523 }],
  createParser: createUranoParser,
};
