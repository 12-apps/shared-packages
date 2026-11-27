import { inflateRawSync } from 'node:zlib';

type Entry = [string, string];

interface Record {
  name: string;
  compressed: number;
  offset: number;
  next: number;
}

/** The central-directory record at `at`, its ZIP64 sizes and offset read from its extra field. */
function recordAt(buffer: Buffer, at: number): Record {
  if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error(`no central header at ${at}`);
  const nameLength = buffer.readUInt16LE(at + 28);
  const extraLength = buffer.readUInt16LE(at + 30);
  const commentLength = buffer.readUInt16LE(at + 32);
  const extra = at + 46 + nameLength;
  if (buffer.readUInt16LE(extra) !== 0x0001) throw new Error(`no ZIP64 extra at ${at}`);
  return {
    name: buffer.subarray(at + 46, extra).toString('utf8'),
    compressed: Number(buffer.readBigUInt64LE(extra + 12)),
    offset: Number(buffer.readBigUInt64LE(extra + 20)),
    next: extra + extraLength + commentLength,
  };
}

function contentOf(buffer: Buffer, record: Record): string {
  const local = record.offset + 30 + buffer.readUInt16LE(record.offset + 26) + buffer.readUInt16LE(record.offset + 28);
  return inflateRawSync(buffer.subarray(local, local + record.compressed)).toString('utf8');
}

/** The directory's records from `start`, `count` of them, in one pass (an archive can hold 70 000). */
function recordsFrom(buffer: Buffer, start: number, count: number): Record[] {
  const records: Record[] = [];
  Array.from({ length: count }).reduce<number>((at) => {
    const record = recordAt(buffer, at);
    records.push(record);
    return record.next;
  }, start);
  return records;
}

/** Where the ZIP64 end record says the directory is, and how many entries it holds. */
export function directoryOf(bytes: Uint8Array): { count: number; offset: number } {
  const buffer = Buffer.from(bytes);
  const locator = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
  const end64 = Number(buffer.readBigUInt64LE(locator + 8));
  if (buffer.readUInt32LE(end64) !== 0x06064b50) throw new Error('no ZIP64 end record');
  return { count: Number(buffer.readBigUInt64LE(end64 + 32)), offset: Number(buffer.readBigUInt64LE(end64 + 48)) };
}

/**
 * Read a ZIP64 archive back from its central directory, the way an unzip tool
 * does: `[name, text]` per entry, in the directory's order. The zip writer's
 * tests' only reader.
 */
export function readZip(bytes: Uint8Array): Entry[] {
  const buffer = Buffer.from(bytes);
  const { count, offset } = directoryOf(bytes);
  return recordsFrom(buffer, offset, count).map((record) => [record.name, contentOf(buffer, record)]);
}
