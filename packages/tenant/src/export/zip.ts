import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { crc32, createDeflateRaw, deflateRawSync } from 'node:zlib';

/**
 * The streaming ZIP64 writer of a tenant's data archive.
 *
 * The archive can be big (years of documents are tens of thousands of files,
 * a busy tenant's history hundreds of thousands of CSV lines), so nothing
 * holds it whole: each entry is DEFLATEd and written to the sink as it comes,
 * a file at a time or a CSV page at a time, and only the central directory's
 * small records (name, CRC, sizes, offset) stay in memory until the end.
 *
 * Every entry is ZIP64 with a data descriptor (PKWARE APPNOTE 6.3.x, §4.3.9
 * and §4.5.3): its local header says "sizes follow", its sizes are written
 * after the data as 8-byte values, and the end of the archive carries the
 * ZIP64 end record and locator. So there is no 65 535-entry or 4 GiB cap, and
 * a streamed entry's size need not be known before it is written. Names are
 * UTF-8 (general purpose bit 11), so an accented name reads as written.
 *
 * The bytes are the extracted host writer's, unchanged (the golden test).
 * Server-only.
 */

/** Where the bytes go: a temp file in production, memory in a test. */
export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Give up: release what the sink holds (a file descriptor), without finishing it. */
  abort(): void;
}

const LOCAL_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const CENTRAL_HEADER = 0x02014b50;
const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const END_OF_CENTRAL = 0x06054b50;
const VERSION = 45;
/** Bit 3 (sizes in a data descriptor) and bit 11 (UTF-8 names). */
const FLAGS = 0x0808;
const DEFLATE = 8;
const ZIP64_EXTRA = 0x0001;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

/** 1980-01-01 00:00 in MS-DOS time: the archive carries no clock, so two builds of one tenant's data are the same bytes. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

interface Written {
  name: Buffer;
  crc: number;
  size: number;
  compressed: number;
  offset: number;
}

function bytesOf(data: string | Uint8Array): Buffer {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
}

function localHeader(name: Buffer): Buffer {
  const header = Buffer.alloc(30 + name.length + 20);
  header.writeUInt32LE(LOCAL_HEADER, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(DEFLATE, 8);
  header.writeUInt16LE(DOS_DATE, 12);
  // CRC and both sizes come in the data descriptor; ZIP64 marks the sizes with all ones.
  header.writeUInt32LE(MAX32, 18);
  header.writeUInt32LE(MAX32, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(20, 28);
  name.copy(header, 30);
  // The ZIP64 extra field, sizes zero here: the descriptor has the real ones.
  header.writeUInt16LE(ZIP64_EXTRA, 30 + name.length);
  header.writeUInt16LE(16, 32 + name.length);
  return header;
}

function dataDescriptor(entry: Written): Buffer {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(DATA_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(entry.crc, 4);
  descriptor.writeBigUInt64LE(BigInt(entry.compressed), 8);
  descriptor.writeBigUInt64LE(BigInt(entry.size), 16);
  return descriptor;
}

function centralHeader(entry: Written): Buffer {
  const header = Buffer.alloc(46 + entry.name.length + 28);
  header.writeUInt32LE(CENTRAL_HEADER, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(DEFLATE, 10);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(MAX32, 20);
  header.writeUInt32LE(MAX32, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(28, 30);
  // Comment, disk number, internal and external attributes: none.
  header.writeUInt32LE(MAX32, 42);
  entry.name.copy(header, 46);
  const extra = 46 + entry.name.length;
  header.writeUInt16LE(ZIP64_EXTRA, extra);
  header.writeUInt16LE(24, extra + 2);
  header.writeBigUInt64LE(BigInt(entry.size), extra + 4);
  header.writeBigUInt64LE(BigInt(entry.compressed), extra + 12);
  header.writeBigUInt64LE(BigInt(entry.offset), extra + 20);
  return header;
}

function endRecords(count: number, directorySize: number, directoryOffset: number): Buffer {
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(ZIP64_END, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(VERSION, 12);
  zip64End.writeUInt16LE(VERSION, 14);
  zip64End.writeBigUInt64LE(BigInt(count), 24);
  zip64End.writeBigUInt64LE(BigInt(count), 32);
  zip64End.writeBigUInt64LE(BigInt(directorySize), 40);
  zip64End.writeBigUInt64LE(BigInt(directoryOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP64_LOCATOR, 0);
  locator.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(Math.min(count, MAX16), 8);
  end.writeUInt16LE(Math.min(count, MAX16), 10);
  end.writeUInt32LE(MAX32, 12);
  end.writeUInt32LE(MAX32, 16);
  return Buffer.concat([zip64End, locator, end]);
}

/** One archive being written to `sink`. Entries are added in order; `finish` writes the directory and closes the sink. */
export class ZipWriter {
  private readonly entries: Written[] = [];
  private readonly names = new Set<string>();
  private offset = 0;

  constructor(private readonly sink: ZipSink) {}

  /** How many entries are in so far. */
  get count(): number {
    return this.entries.length;
  }

  private async emit(chunk: Uint8Array): Promise<void> {
    this.offset += chunk.length;
    await this.sink.write(chunk);
  }

  private async open(name: string): Promise<Written> {
    if (this.names.has(name)) throw new Error(`zip: "${name}" twice`);
    this.names.add(name);
    const entry: Written = { name: Buffer.from(name, 'utf8'), crc: 0, size: 0, compressed: 0, offset: this.offset };
    await this.emit(localHeader(entry.name));
    return entry;
  }

  private async close(entry: Written): Promise<void> {
    await this.emit(dataDescriptor(entry));
    this.entries.push(entry);
  }

  /** A small entry held whole (a document, a catalogue). */
  async addFile(name: string, data: string | Uint8Array): Promise<void> {
    const entry = await this.open(name);
    const bytes = bytesOf(data);
    const body = deflateRawSync(bytes);
    Object.assign(entry, { crc: crc32(bytes), size: bytes.length, compressed: body.length });
    await this.emit(body);
    await this.close(entry);
  }

  /** An entry written as its chunks arrive (a CSV, page by page): never held whole. */
  async addStream(name: string, chunks: AsyncIterable<string | Uint8Array>): Promise<void> {
    const entry = await this.open(name);
    const deflate = createDeflateRaw();
    const drained = (async () => {
      for await (const out of deflate as AsyncIterable<Buffer>) {
        entry.compressed += out.length;
        await this.emit(out);
      }
    })();
    try {
      for await (const chunk of chunks) {
        const bytes = bytesOf(chunk);
        entry.crc = crc32(bytes, entry.crc);
        entry.size += bytes.length;
        if (!deflate.write(bytes)) await once(deflate, 'drain');
      }
      deflate.end();
      await drained;
    } catch (error) {
      // A page that failed mid-entry: the deflate stream is released, and its reader is let finish quietly.
      deflate.destroy();
      await drained.catch(() => undefined);
      throw error;
    }
    await this.close(entry);
  }

  /** An aborted build: the sink lets go of what it holds; the archive is never finished. */
  abort(): void {
    this.sink.abort();
  }

  /** The central directory and the end records; the sink is closed after. */
  async finish(): Promise<number> {
    const directoryOffset = this.offset;
    let directorySize = 0;
    for (const entry of this.entries) {
      const header = centralHeader(entry);
      directorySize += header.length;
      await this.emit(header);
    }
    await this.emit(endRecords(this.entries.length, directorySize, directoryOffset));
    await this.sink.close();
    return this.offset;
  }
}

/** A sink onto a file, honouring the stream's backpressure. */
export function fileSink(path: string): ZipSink {
  const stream = createWriteStream(path);
  return {
    async write(chunk) {
      if (!stream.write(chunk)) await once(stream, 'drain');
    },
    async close() {
      stream.end();
      await once(stream, 'finish');
    },
    abort() {
      stream.destroy();
    },
  };
}
