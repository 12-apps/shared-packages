/**
 * Wire views the research screens render — the exact shapes the host's
 * research API answers with. Offer/stat/query shapes come from the engine
 * package so a host's REST layer, the engine and these screens can never
 * disagree about a field.
 */
import type { OfferOutput, ResearchQueryInput } from '@12-apps/product-research';

export type { OfferOutput, ResearchQueryInput };

/** The latest run stamp a request view carries. */
export interface RunStamp {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Where the research was started FROM, when it was started from a catalog entry
 * (a product page's widget, a low-stock row). Carried on the request view so a
 * repeat can reproduce the original pointer instead of dropping it (FUT-494).
 */
export interface CatalogRef {
  type: string;
  id: string;
}

/** One research request, as the host lists/polls it. */
export interface ResearchRequestView {
  id: string;
  term: string;
  brand: string | null;
  ean: string | null;
  quantity: number;
  region: string | null;
  /** The catalog entry this research was started from, when there was one. */
  catalogRef: CatalogRef | null;
  createdAt: string;
  latestRun: RunStamp | null;
}

/** Per-source outcome of a run (mirrors the engine's `sourceStatSchema`). */
export interface SourceStatView {
  sourceId: string;
  type: string;
  name: string;
  status: 'OK' | 'CACHED' | 'FAILED' | 'BUDGET_EXCEEDED' | 'SKIPPED';
  offerCount: number;
  ms: number;
  error?: string;
  /**
   * FUT-491: the source answered with its DEFAULT region's prices because it
   * does not deliver to the queried CEP. A carrier flag beside an unchanged
   * `status` (the source did succeed) — the chip reads "outra região".
   */
  outsideDeliveryArea?: boolean;
  /**
   * FUT-516: the source hit the per-source time ceiling and stopped
   * mid-search. Another carrier flag beside an unchanged `status` — on OK or
   * CACHED the offers are real but the list may be short (and any check the
   * search never reached, like delivery to the CEP, was not made); on FAILED
   * the ceiling arrived before anything came back.
   */
  truncated?: boolean;
}

/** One run with its stats and ranked offers. */
export interface ResearchRunView {
  id: string;
  requestId: string;
  status: string;
  sourceStats: SourceStatView[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  offers: OfferOutput[];
}

/** A configured price source — the roster shown while a run is in flight. */
export interface SourceSummary {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  status: string;
}

/** Standard list pagination the host APIs answer with. */
export interface ListPagination {
  total: number;
  pageCount: number;
  hasNextPage: boolean;
}
