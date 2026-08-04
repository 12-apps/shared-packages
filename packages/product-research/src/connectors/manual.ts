import type { RawOffer, ResearchQuery, SourceRecord } from '../types';
import type { ConnectorResult, PriceSourceConnector } from './types';

/**
 * MANUAL source connector (FUT-415): serves the prices a tenant imported by
 * hand — bottler price lists, distributor tables, phone quotes — from the
 * host's store instead of the network. Every live entry is returned as a raw
 * offer and the pipeline's relevance scorer decides what matches the query,
 * exactly as it does for network connectors, so imported rows compete in the
 * same ranked comparison with no separate matching logic to drift.
 *
 * `cacheable: false`: the data is already local, and caching it would hide a
 * fresh re-import for a whole TTL.
 */

/** One live (non-expired) manual price entry, as the host store returns it. */
export interface ManualPriceRecord {
  supplierName: string;
  title: string;
  brand?: string;
  ean?: string;
  packQuantity?: number;
  priceCents: number;
  currency: string;
  url?: string;
  availability?: string;
  etaDays?: number;
  validUntil: Date;
}

/**
 * The host seam: return the LIVE entries of one manual source — expired rows
 * (`validUntil <= at`) must already be filtered out, so staleness is enforced
 * in one place regardless of which host mounts the connector.
 */
export interface ManualPriceStore {
  listLiveEntries(input: {
    clientId: string;
    sourceId: string;
    at: Date;
  }): Promise<ManualPriceRecord[]>;
}

const AVAILABILITY: readonly RawOffer['availability'][] = ['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'];

const toRawOffer = (entry: ManualPriceRecord, source: SourceRecord): RawOffer => ({
  supplierName: entry.supplierName || source.name,
  title: entry.title,
  url: entry.url,
  ean: entry.ean,
  currency: entry.currency,
  priceCents: entry.priceCents,
  packQuantity: entry.packQuantity,
  availability: AVAILABILITY.includes(entry.availability as RawOffer['availability'])
    ? (entry.availability as RawOffer['availability'])
    : undefined,
  etaDays: entry.etaDays,
  expiresAt: entry.validUntil,
  raw: entry,
});

export const createManualConnector = (store: ManualPriceStore): PriceSourceConnector => ({
  type: 'MANUAL',
  cacheable: false,
  // The trailing ConnectorContext param is omitted: this connector needs no
  // network and no logger — the store either answers or errors visibly.
  async search(_query: ResearchQuery, source: SourceRecord): Promise<ConnectorResult> {
    try {
      const entries = await store.listLiveEntries({
        clientId: source.clientId,
        sourceId: source.id,
        at: new Date(),
      });
      return { ok: true, offers: entries.map((entry) => toRawOffer(entry, source)) };
    } catch (error) {
      return {
        ok: false,
        error: `manual price store unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
