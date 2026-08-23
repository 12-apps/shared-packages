import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import {
  guessHeaderMapping,
  normalizeManualRows,
  parseCsvPriceList,
  readCsvHeaders,
} from '../import/manual';
import { createManualConnector } from '../connectors/manual';
import type { ManualPriceRecord } from '../connectors/manual';
import { ConnectorRegistry } from '../connectors/registry';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import type { SourceRecord } from '../types';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

/**
 * The FUT-415 acceptance sheet: a distributor CSV with mixed volumes,
 * "R$ 1.234,56"-style prices, a quoted field, a BR-format validity date, an
 * invalid EAN, and one unmappable row (no price). The unmappable row must be
 * SURFACED, never dropped silently.
 */
const DISTRIBUTOR_CSV = [
  'Produto;Marca;Embalagem;Preço;EAN;Validade',
  'Coca-Cola Original Lata 350ml;Coca-Cola;12;R$ 42,90;7894900011517;31/08/2026',
  '"Coca-Cola Original;Pet 2L";Coca-Cola;6;R$ 1.234,56;7894900027013;',
  'Guaraná Antarctica 1L;Ambev;;8,99;ABC123;',
  'Água Mineral 500ml;;;;;',
].join('\n');

const source = (): SourceRecord => ({
  id: 'manual-1',
  clientId: 'tenant-1',
  type: 'MANUAL',
  name: 'Distribuidora Solar',
  config: {},
  enabled: true,
  status: 'ACTIVE',
});

describe('parseCsvPriceList', () => {
  it('parses the distributor sheet and surfaces the unmappable row', () => {
    const { rows, problems } = parseCsvPriceList({ content: DISTRIBUTOR_CSV, headerAliases: PT_BR_MARKET_VOCABULARY.headerAliases }, PT_BR_RESEARCH_DIAGNOSTICS.manualImport);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      title: 'Coca-Cola Original Lata 350ml',
      brand: 'Coca-Cola',
      packQuantity: 12,
      price: 'R$ 42,90',
      ean: '7894900011517',
    });
    expect(rows[0]?.validUntil).toBe('2026-08-31');
    // The quoted field keeps its embedded delimiter.
    expect(rows[1]?.title).toBe('Coca-Cola Original;Pet 2L');
    // The row with no price is a problem carrying its line number.
    expect(problems).toEqual([{ line: 4, reason: expect.stringContaining('linha não importável') }]);
  });

  it('fails loudly when required columns cannot be found', () => {
    const { rows, problems } = parseCsvPriceList(
      { content: 'Foo;Bar\n1;2', headerAliases: PT_BR_MARKET_VOCABULARY.headerAliases },
      PT_BR_RESEARCH_DIAGNOSTICS.manualImport,
    );
    expect(rows).toEqual([]);
    expect(problems[0]?.reason).toContain('colunas obrigatórias');
  });

  it('honors an explicit column mapping and comma delimiter', () => {
    const csv = 'Item,Custo\nCafé Torrado 1kg,"R$ 89,90"';
    const { rows, problems } = parseCsvPriceList({ content: csv, headerAliases: PT_BR_MARKET_VOCABULARY.headerAliases, mapping: { title: 'Item', price: 'Custo' },
    }, PT_BR_RESEARCH_DIAGNOSTICS.manualImport);
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ title: 'Café Torrado 1kg', price: 'R$ 89,90' });
  });
});

describe('readCsvHeaders / guessHeaderMapping', () => {
  it('reads the header row with the delimiter the parser will use', () => {
    expect(readCsvHeaders(DISTRIBUTOR_CSV)).toEqual({
      headers: ['Produto', 'Marca', 'Embalagem', 'Preço', 'EAN', 'Validade'],
      delimiter: ';',
    });
    expect(readCsvHeaders('Item,Custo\na,1')).toEqual({
      headers: ['Item', 'Custo'],
      delimiter: ',',
    });
  });

  it('guesses the same columns the parser resolves, as header names', () => {
    const { headers } = readCsvHeaders(DISTRIBUTOR_CSV);
    expect(guessHeaderMapping(headers, PT_BR_MARKET_VOCABULARY.headerAliases)).toEqual({
      title: 'Produto',
      brand: 'Marca',
      packQuantity: 'Embalagem',
      price: 'Preço',
      ean: 'EAN',
      validUntil: 'Validade',
    });
    // Unrecognized headers simply do not map — the UI asks the buyer.
    expect(guessHeaderMapping(['Foo', 'Bar'], PT_BR_MARKET_VOCABULARY.headerAliases)).toEqual({});
  });
});

describe('normalizeManualRows', () => {
  it('converts BR money to cents and applies the default validity', () => {
    const defaultValidUntil = new Date('2026-08-04T00:00:00Z');
    const { rows } = parseCsvPriceList({ content: DISTRIBUTOR_CSV, headerAliases: PT_BR_MARKET_VOCABULARY.headerAliases }, PT_BR_RESEARCH_DIAGNOSTICS.manualImport);
    const { entries, problems } = normalizeManualRows(rows, { defaultValidUntil }, PT_BR_RESEARCH_DIAGNOSTICS.manualImport);

    expect(entries).toHaveLength(3);
    expect(entries[0]?.priceCents).toBe(4290);
    expect(entries[1]?.priceCents).toBe(123_456);
    expect(entries[2]?.priceCents).toBe(899);
    expect(entries[1]?.validUntil).toEqual(defaultValidUntil);
    // The invalid EAN is stripped but the row still imports — surfaced, not dropped.
    expect(entries[2]?.ean).toBeUndefined();
    expect(problems).toEqual([{ line: 3, reason: expect.stringContaining('EAN inválido') }]);
  });

  it('reports an unparseable price as a problem, not a silent drop', () => {
    const { entries, problems } = normalizeManualRows(
      [{ title: 'Item bom', price: '10,00' }, { title: 'Item ruim', price: 'a combinar' }],
      { defaultValidUntil: new Date('2026-08-04T00:00:00Z') },
      PT_BR_RESEARCH_DIAGNOSTICS.manualImport,
    );
    expect(entries).toHaveLength(1);
    expect(problems).toEqual([{ line: 2, reason: expect.stringContaining('preço não reconhecido') }]);
  });
});

describe('createManualConnector', () => {
  const entry = (overrides: Partial<ManualPriceRecord> = {}): ManualPriceRecord => ({
    supplierName: 'Distribuidora Solar',
    title: 'Coca-Cola Original Lata 350ml',
    ean: '7894900011517',
    packQuantity: 12,
    priceCents: 4290,
    currency: 'BRL',
    validUntil: new Date('2026-08-04T00:00:00Z'),
    ...overrides,
  });

  it('is uncacheable and maps live entries into raw offers with their validity as expiry', async () => {
    const connector = createManualConnector({
      listLiveEntries: () => Promise.resolve([entry()]),
    });
    expect(connector.cacheable).toBe(false);

    const result = await connector.search(
      { term: 'Coca-Cola Lata 350ml', quantity: 12 },
      source(),
      { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0]).toMatchObject({
        supplierName: 'Distribuidora Solar',
        priceCents: 4290,
        packQuantity: 12,
        ean: '7894900011517',
        expiresAt: new Date('2026-08-04T00:00:00Z'),
      });
    }
  });

  it('reports a failing store as a connector error, never throws', async () => {
    const connector = createManualConnector({
      listLiveEntries: () => Promise.reject(new Error('db down')),
    });
    const result = await connector.search(
      { term: 'x', quantity: 1 },
      source(),
      { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS },
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining('db down') });
  });
});

describe('manual offers through the pipeline', () => {
  it('bypasses the cache and caps offer expiry at the list validity', async () => {
    const store = new InMemoryResearchStore();
    store.sources.push(source());
    const validUntil = new Date('2026-07-29T00:00:00Z');
    const listCalls: Date[] = [];
    const connector = createManualConnector({
      listLiveEntries: ({ at }) => {
        listCalls.push(at);
        return Promise.resolve([
          {
            supplierName: 'Distribuidora Solar',
            title: 'Coca-Cola Original Lata 350ml',
            packQuantity: 12,
            priceCents: 4290,
            currency: 'BRL',
            validUntil,
          },
        ]);
      },
    });

    const cache = new InMemoryCache();
    const cacheWrites: string[] = [];
    const spyCache = {
      get: (key: string) => cache.get(key),
      set: (key: string, value: string, ttl: number) => {
        cacheWrites.push(key);
        return cache.set(key, value, ttl);
      },
    };
    const deps = {
      store,
      cache: spyCache,
      budget: new FixedBudget(10),
      logger: silentLogger,
      diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
      now: () => new Date('2026-07-28T12:00:00Z'),
    };
    const registry = new ConnectorRegistry().register(connector);
    const ctx = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };
    const input = {
      clientId: 'tenant-1',
      requestId: 'req-1',
      query: { term: 'Coca-Cola Original Lata 350ml', quantity: 12 },
    };

    const first = await runResearch(deps, registry, ctx, input);
    const second = await runResearch(deps, registry, ctx, input);

    // No cache writes, and the store answered BOTH runs — a re-import between
    // researches would be visible immediately.
    expect(cacheWrites).toEqual([]);
    expect(listCalls).toHaveLength(2);
    expect(second.sourceStats[0]?.status).toBe('OK');

    // The TTL default would be now+24h (2026-07-29T12:00Z); the list's
    // validity ends earlier (00:00Z) and must cap the offer expiry.
    expect(first.offers[0]?.expiresAt).toEqual(validUntil);
  });
});
