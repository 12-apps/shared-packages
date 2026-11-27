import { describe, expect, it } from 'vitest';

import { cellText, csvHeader, csvLine, defused } from '../export';

/** The archive's CSV lines (ported from the host's sections suite: the engine's half). */

describe('the archive CSV', () => {
  it('defuses a cell a spreadsheet would run as a formula', () => {
    for (const text of ['=HYPERLINK(1)', '+1', '-2', '@SUM(A1)', '\tx', '\rx']) expect(defused(text)).toBe(`'${text}`);
    expect(defused('Ana')).toBe('Ana');
    expect(cellText("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it('writes a raw cell as it is', () => {
    expect(cellText({ raw: '-5' })).toBe('-5');
  });

  it('quotes per RFC 4180, with the BOM a spreadsheet needs on the header', () => {
    expect(csvHeader(['Visit', 'Nº'])).toBe('\ufeffVisit,Nº\r\n');
    expect(csvLine(['a "b"', 'c,d', 'e;f', 'g'])).toBe('"a ""b""","c,d","e;f",g\r\n');
  });
});
