import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import type { CatalogAdapter } from '../ports';
import type { CatalogItem } from '../types';

/**
 * The reuse proof: a toy DENTAL-SUPPLIES host mounts the exact same engine —
 * its own catalog adapter, its own vendor connector — with zero package
 * changes. This is the contract that lets the research product ship to other
 * verticals by "connecting vendors".
 */

const makeDentalCatalog = (): CatalogAdapter => {
  const items: CatalogItem[] = [
    { ref: { type: 'dental-product', id: 'd1' }, name: 'Resina Composta Z350 XT', brand: '3M' },
    {
      ref: { type: 'dental-product', id: 'd2' },
      name: 'Luva Nitrílica M caixa com 100',
      brand: 'Descarpack',
    },
  ];
  return {
    searchItems: (term) =>
      Promise.resolve(items.filter((item) => item.name.toLowerCase().includes(term.toLowerCase()))),
    getItem: (ref) => Promise.resolve(items.find((item) => item.ref.id === ref.id) ?? null),
  };
};

const ctx: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };

describe('second host (dental vertical)', () => {
  it('runs the same pipeline over a dental catalog and vendor', async () => {
    const store = new InMemoryResearchStore();
    store.sources = [
      {
        id: 'dental-store-1',
        clientId: 'clinic-1',
        type: 'VTEX',
        name: 'Dental Store',
        config: { baseUrl: 'https://dentalstore.example' },
        enabled: true,
        status: 'ACTIVE',
      },
    ];

    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () =>
        Promise.resolve({
          ok: true as const,
          offers: [
            {
              supplierName: 'Dental Store',
              title: 'Resina Composta Z350 XT 3M',
              priceCents: 18900,
              availability: 'IN_STOCK' as const,
            },
            {
              supplierName: 'Dental Store',
              title: 'Broca diamantada avulsa',
              priceCents: 900,
            },
          ],
        }),
    });

    const dentalCatalog = makeDentalCatalog();
    const [item] = await dentalCatalog.searchItems('resina');
    if (!item) throw new Error('dental catalog search returned nothing');
    expect(item.ref.type).toBe('dental-product');

    const result = await runResearch(
      {
        store,
        cache: new InMemoryCache(),
        budget: new FixedBudget(10),
        logger: silentLogger,
        diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
      },
      registry,
      ctx,
      {
        clientId: 'clinic-1',
        requestId: 'req-dental-1',
        query: { term: item.name, brand: item.brand, quantity: 2 },
      },
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.title).toContain('Resina');
    expect(store.offers[0]?.clientId).toBe('clinic-1');
  });
});
