/**
 * The headless data contract (FUT-420): every screen in this package reads
 * and writes through this interface, and the HOST implements it over its own
 * API, auth and tenancy. No fetch happens inside the package — that is what
 * lets the same screens drop into another vertical unchanged.
 */
import type { ResearchQueryInput } from '@12-apps/product-research';

import type {
  CatalogRef,
  ListPagination,
  ResearchRequestView,
  ResearchRunView,
  SourceSummary,
} from './types';

export interface ResearchApiClient {
  /**
   * Kick off a research; the run is created asynchronously by the host.
   *
   * `options.catalogRef` re-states the catalog entry a research was started
   * from — only a REPEAT of a stored request has one to pass (FUT-494); the
   * form never does. Optional so an existing single-argument implementation
   * stays a valid client.
   */
  startResearch(
    query: ResearchQueryInput,
    options?: { catalogRef?: CatalogRef },
  ): Promise<{ requestId: string }>;
  /** One request with its latest run — the poll target after a start. */
  getRequest(requestId: string): Promise<ResearchRequestView>;
  /** One run with per-source stats and ranked offers. */
  getRun(runId: string): Promise<ResearchRunView>;
  /** Past requests, newest first. `term` narrows to one product's researches
   * — the embedded widget's lookup. Exact matches rank first, then
   * accent/case-folded and near variants; an unmatched term returns an empty
   * page (FUT-430). */
  listRequests(input: {
    page: number;
    pageSize: number;
    term?: string;
  }): Promise<{ data: ResearchRequestView[]; pagination: ListPagination }>;
  /** The configured source roster (for in-flight status rows). */
  listSources(): Promise<SourceSummary[]>;
}
