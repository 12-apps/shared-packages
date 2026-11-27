import { describe, expect, it } from 'vitest';

import { ZipWriter, type ZipSink } from '../export';
import { directoryOf, readZip } from './export-zip-reader';

/** A sink that keeps the archive in memory, for reading it back. */
function memorySink(): { sink: ZipSink; bytes: () => Uint8Array } {
  const chunks: Buffer[] = [];
  return {
    sink: { write: async (chunk) => void chunks.push(Buffer.from(chunk)), close: async () => undefined, abort: () => undefined },
    bytes: () => new Uint8Array(Buffer.concat(chunks)),
  };
}

async function* pages(...parts: string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

describe('ZipWriter', () => {
  it('writes whole and streamed entries an unzip reads back byte for byte, with UTF-8 names', async () => {
    const memory = memorySink();
    const zip = new ZipWriter(memory.sink);
    await zip.addFile('catálogo.csv', 'Nome,Preço\r\nChá,"12,90"\r\n');
    await zip.addStream('visits.csv', pages('Visit,No.\r\n', 'A1,1\r\n', 'B2,2\r\n'));
    await zip.addFile('documents/KIND/123.xml', '<doc/>');
    await zip.finish();
    expect(readZip(memory.bytes())).toEqual([
      ['catálogo.csv', 'Nome,Preço\r\nChá,"12,90"\r\n'],
      ['visits.csv', 'Visit,No.\r\nA1,1\r\nB2,2\r\n'],
      ['documents/KIND/123.xml', '<doc/>'],
    ]);
  });

  it('has no 65 535-entry cap: 70 000 entries are all in the directory and read back', async () => {
    const memory = memorySink();
    const zip = new ZipWriter(memory.sink);
    for (let index = 0; index < 70_000; index += 1) await zip.addFile(`n/${index}.xml`, `<n>${index}</n>`);
    await zip.finish();
    const bytes = memory.bytes();
    expect(directoryOf(bytes).count).toBe(70_000);
    const entries = readZip(bytes);
    expect(entries).toHaveLength(70_000);
    expect(entries[69_999]).toEqual(['n/69999.xml', '<n>69999</n>']);
  }, 60_000);

  it('is the same bytes for the same files: the archive carries no clock', async () => {
    const first = memorySink();
    const second = memorySink();
    for (const memory of [first, second]) {
      const zip = new ZipWriter(memory.sink);
      await zip.addFile('a.csv', 'x');
      await zip.finish();
    }
    expect(Buffer.from(first.bytes()).equals(Buffer.from(second.bytes()))).toBe(true);
  });

  it('refuses a name twice rather than writing an archive that hides one', async () => {
    const zip = new ZipWriter(memorySink().sink);
    await zip.addFile('a.csv', '1');
    await expect(zip.addFile('a.csv', '2')).rejects.toThrow(/twice/);
  });

  it('lets go of the deflate stream and the sink when a streamed entry fails mid-way', async () => {
    const aborted = { count: 0 };
    const sink: ZipSink = { write: async () => undefined, close: async () => undefined, abort: () => void (aborted.count += 1) };
    const zip = new ZipWriter(sink);
    async function* failing(): AsyncIterable<string> {
      yield 'Visit\r\n';
      throw new Error('page read failed');
    }
    await expect(zip.addStream('visits.csv', failing())).rejects.toThrow('page read failed');
    zip.abort();
    expect(aborted.count).toBe(1);
  });

  it('writes an empty archive as just its end records', async () => {
    const memory = memorySink();
    await new ZipWriter(memory.sink).finish();
    expect(readZip(memory.bytes())).toEqual([]);
  });
});
