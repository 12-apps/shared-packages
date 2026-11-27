import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { TenantExportCell, TenantExportSection } from '../export';
import { exportHost, exportRequest } from './export-fixtures';
import golden from './export-golden.json';
import { readZip } from './export-zip-reader';

/**
 * The golden archive: `export-golden.json` holds a fixed set of sections and
 * the bytes the host's own writer (its `ZipWriter`, `csvHeader`, `csvLine` and
 * `defused`, run unchanged) wrote for them. The engine, given the same
 * sections, must keep the very same bytes: the same entries in the same
 * order, the same CSV bytes, the same compressed stream.
 */

interface RowsInput {
  name: string;
  header: string[];
  pages: TenantExportCell[][][];
}

function rows(input: RowsInput): TenantExportSection {
  return {
    kind: 'rows',
    name: input.name,
    header: () => input.header,
    pages: async function* pages() {
      for (const page of input.pages) yield page;
    },
  };
}

function sections(): TenantExportSection[] {
  const { input } = golden as unknown as {
    input: { catalog: { name: string; data: string }; orders: RowsInput; customers: RowsInput; files: { name: string; data: string }[] };
  };
  return [
    { kind: 'file', name: input.catalog.name, data: async () => input.catalog.data },
    rows(input.orders),
    rows(input.customers),
    {
      kind: 'files',
      files: async function* files() {
        for (const file of input.files) yield file;
      },
    },
  ];
}

describe('the golden archive', () => {
  it('stores byte for byte what the host writer wrote for the same sections', async () => {
    const env = exportHost({ sections: sections() });
    const engine = env.build();
    const state = await engine.request({ request: exportRequest(), slug: 'north', now: new Date('2026-11-25T12:00:00.000Z') });
    await expect(engine.build(state.id, new Date('2026-11-25T12:00:00.000Z'))).resolves.toBe('built');
    const stored = env.objects.get(`exports/t-1/${state.id}.zip`) as Buffer;
    expect(stored.length).toBe(golden.expected.size);
    expect(createHash('sha256').update(stored).digest('hex')).toBe(golden.expected.sha256);
    expect(stored.toString('base64')).toBe(golden.expected.base64);
    expect(env.rows.get(state.id)?.sizeBytes).toBe(golden.expected.size);
  });

  it('reads back as the same entries and the same CSV bytes', () => {
    const entries = readZip(new Uint8Array(Buffer.from(golden.expected.base64, 'base64')));
    expect(entries.map(([name]) => name)).toEqual([
      'catálogo.csv',
      'atendimentos.csv',
      'contatos.csv',
      'documentos/LAUDO/35261100000000000000650010000000011000000010.xml',
      'documentos/LAUDO/35261100000000000000650010000000011000000010-evento.xml',
      'documentos/RECEITA/k3.xml',
    ]);
    const csv = Object.fromEntries(entries);
    // The typed cells neutralised, the raw ones (a negative amount) as they are, quoting per RFC 4180.
    const line = csv['atendimentos.csv']?.split('\r\n')[2] ?? '';
    expect(line).toMatch(/^B2C3D4E5,—,"21\/11\/2026, 09:05",'=cmd/u);
    expect(line).toMatch(/"Raio-X ""tórax""; laudo","-R\$ 5,00",/u);
    expect(csv['contatos.csv']?.startsWith('\ufeffContato,Email')).toBe(true);
  });
});
