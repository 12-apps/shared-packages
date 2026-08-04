import { describe, expect, it } from 'vitest';

import { printableTitle } from '../lib/print-export';

/**
 * FUT-310: the browser suggests `document.title` as the PDF filename — the
 * title must stay meaningful for any report name.
 */
describe('printableTitle', () => {
  it('collapses whitespace and falls back for empty names', () => {
    expect(printableTitle('  Receita   por método ')).toBe('Receita por método');
    expect(printableTitle('   ')).toBe('relatorio');
  });
});
