import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportRows, type ExportColumn } from '../utils/export-rows';

/**
 * The producing half of the grid's Export control.
 *
 * What is on trial is the serialisation, not the download: a browser download
 * is three DOM calls and asserting them would test jsdom. The CSV escaping IS
 * worth cases, because getting it wrong does not look like a bug — one name
 * containing a comma shifts every column after it, and the file reads as
 * corrupt data.
 */

interface Row {
  name: string;
  count: number;
  active: boolean;
  note: string | null;
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Count', value: (row) => row.count },
  { header: 'Active', value: (row) => row.active },
  { header: 'Note', value: (row) => row.note },
];

const ROWS: Row[] = [
  { name: 'First', count: 2, active: true, note: null },
  { name: 'Second, with comma', count: 0, active: false, note: 'say "hi"' },
];

/** Capture what would have been downloaded, without touching a real anchor. */
function captureDownload(): { files: { name: string; type: string; text: string }[] } {
  const files: { name: string; type: string; text: string }[] = [];
  // The name is read at CLICK time, not when the blob is made: the helper
  // creates the object URL before it sets `download`, so capturing earlier
  // would record an empty string for every file.
  const anchor = {
    href: '',
    download: '',
    click: () => {
      const last = files[files.length - 1];
      if (last) last.name = anchor.download;
    },
    remove: () => {},
  };
  vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
  vi.stubGlobal(
    'Blob',
    class {
      constructor(
        readonly parts: string[],
        readonly options: { type: string },
      ) {
        files.push({ name: '', type: options.type, text: parts.join('') });
      }
    },
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  return { files };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CSV', () => {
  it('E1: writes the headers, then one line per row', () => {
    const { files } = captureDownload();
    exportRows('csv', [ROWS[0] as Row], COLUMNS, 'rows');
    expect(files[0]?.text).toBe('Name,Count,Active,Note\nFirst,2,true,');
  });

  it('E2: quotes a cell containing a comma, so the columns do not shift', () => {
    const { files } = captureDownload();
    exportRows('csv', [ROWS[1] as Row], COLUMNS, 'rows');
    expect(files[0]?.text).toContain('"Second, with comma"');
  });

  it('E3: doubles an embedded quote, which is what a CSV reader expects', () => {
    const { files } = captureDownload();
    exportRows('csv', [ROWS[1] as Row], COLUMNS, 'rows');
    expect(files[0]?.text).toContain('"say ""hi"""');
  });

  it('E4: writes an empty cell for null, not the word "null"', () => {
    const { files } = captureDownload();
    exportRows('csv', [ROWS[0] as Row], COLUMNS, 'rows');
    expect(files[0]?.text.endsWith('true,')).toBe(true);
  });

  it('E5: names the file after the consumer’s word for the collection', () => {
    const { files } = captureDownload();
    exportRows('csv', ROWS, COLUMNS, 'descontos');
    expect(files[0]?.name).toBe('descontos.csv');
    expect(files[0]?.type).toContain('text/csv');
  });
});

describe('JSON', () => {
  it('E6: keys each record by the column HEADER, so both files read alike', () => {
    const { files } = captureDownload();
    exportRows('json', [ROWS[0] as Row], COLUMNS, 'rows');
    expect(JSON.parse(files[0]?.text ?? '')).toEqual([
      { Name: 'First', Count: 2, Active: true, Note: null },
    ]);
  });

  it('E7: keeps null as null — the one thing JSON can say and CSV cannot', () => {
    const { files } = captureDownload();
    exportRows('json', [ROWS[0] as Row], COLUMNS, 'rows');
    expect(files[0]?.text).toContain('"Note": null');
    expect(files[0]?.name).toBe('rows.json');
  });
});
