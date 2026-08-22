import type { DataViewsCopy } from '@12-apps/ui/data-display/DataViews';

/**
 * Every user-facing string of the research screens — REQUIRED on each screen,
 * with no defaults (the copy-portability doctrine): the old pt-BR defaults
 * meant a host that passed nothing shipped another product's voice, silently.
 * A pt-BR host imports {@link PT_BR_RESEARCH_MESSAGES} from `./pt-BR`
 * (re-exported at the package root) and passes it by hand — one reviewable
 * line. (This was the repo's first messages layer; requiring it closes the
 * half the original acceptance criterion left open.)
 *
 * Functions rather than template strings where a value is interpolated, so a
 * translation can reorder freely.
 */

export interface ResearchMessages {
  formTitle: string;
  formTermLabel: string;
  formTermPlaceholder: string;
  formBrandLabel: string;
  formQuantityLabel: string;
  formRegionLabel: string;
  formSubmit: string;
  formSubmitBusy: string;
  formTermRequired: string;
  formStartFailed: string;

  statusTitle: string;
  statusQuerying: string;
  statusOk: (offerCount: number) => string;
  statusCached: (offerCount: number) => string;
  /**
   * A source that answered with ANOTHER region's prices because it does not
   * deliver to this CEP (FUT-491) — a distinct reading from a plain OK, so the
   * buyer sees where the numbers came from without opening a row.
   */
  statusOkOutsideArea: (offerCount: number) => string;
  statusCachedOutsideArea: (offerCount: number) => string;
  /**
   * A source cut short by the per-source time ceiling (FUT-516). It ANSWERED,
   * so these offers are real — but the list may be shorter than the store's,
   * and the count must not read like a complete one.
   */
  statusOkTruncated: (offerCount: number) => string;
  statusCachedTruncated: (offerCount: number) => string;
  /** Its tooltip: what was cut short, and what was therefore NOT checked. */
  truncatedHint: string;
  statusFailed: string;
  statusBudget: string;
  statusSkipped: string;
  /**
   * WHY a source failed (FUT-495) — the connector's recorded reason, shown
   * under the row and carried in the chip's accessible description. "A fonte
   * não respondeu" answers nothing; "a loja recusou nosso acesso (HTTP 403)"
   * is the difference between guessing and fixing.
   */
  statusFailureReason: (reason: string) => string;
  /** A failed source that recorded no reason at all — still say something. */
  statusReasonUnknown: string;

  runQueued: string;
  runRunning: string;
  runFailedTitle: string;
  degradedTitle: string;
  degradedBody: string;

  bestOfferTitle: string;
  unitPriceSuffix: string;
  totalFor: (quantity: number) => string;
  packMath: (totalLabel: string, packQuantity: number, unitLabel: string) => string;
  openOffer: string;
  relevance: (percent: number) => string;
  availabilityInStock: string;
  availabilityOutOfStock: string;
  availabilityUnknown: string;
  etaDays: (days: number) => string;
  /** Compact badge on an offer priced for the store's default region. */
  outsideAreaBadge: string;
  /** Its tooltip — why the price is there and what it does NOT promise. */
  outsideAreaHint: string;
  /** Compact badge on a one-unit price that looks like a whole multipack. */
  suspectUnitPriceBadge: string;
  /** Its tooltip — what the suspicion is and what the buyer should check. */
  suspectUnitPriceHint: string;
  /** Compact badge on a total the source gave no shipping cost for (FUT-518). */
  shippingUnknownBadge: string;
  /** Its tooltip — that the total is a minimum, and where to confirm it. */
  shippingUnknownHint: string;

  offersTitle: string;
  /** Heading over the offers already found while the run is still in flight. */
  offersPartialTitle: string;
  /**
   * What the partial table does and does NOT promise (FUT-519) — that sources
   * are still answering, that the order shown is already the final one, and
   * that the hero card and the unit-price caveats wait for the end.
   */
  offersPartialNote: string;
  offersEmptyTitle: string;
  offersEmptyBody: string;
  columnRank: string;
  columnSupplier: string;
  columnSource: string;
  columnProduct: string;
  columnPack: string;
  columnUnitPrice: string;
  columnTotal: string;
  columnAvailability: string;
  columnRelevance: string;
  columnLink: string;
  packUnits: (units: number) => string;

  widgetTitle: string;
  widgetEmpty: string;
  widgetSearch: string;
  widgetOpen: string;
  widgetFreshness: (stamp: string) => string;

  historyTitle: string;
  historyEmpty: string;
  historyOpen: string;
  /** Re-runs a past research from its stored query (FUT-494). */
  historyRepeat: string;
  /** Why the repeat is disabled while the request's run is still in flight. */
  historyRepeatRunningHint: string;
  /** Leaves the bounded block for the full, filterable history page. */
  historyViewAll: string;
  historyQuantity: (quantity: number) => string;
  historyStatusDone: string;
  historyStatusRunning: string;
  historyStatusFailed: string;
  historyStatusNone: string;
  /**
   * The offers grid is a `@12-apps/ui` DataViews surface, and that package
   * stopped shipping default words for it (FUT-760). This screen mounts the
   * surface, so it is the one that has to name them.
   */
  dataViews: DataViewsCopy;
}

/** The defaults with a screen's overrides folded in. */
export function resolveMessages(messages: ResearchMessages): ResearchMessages {
  return messages;
}
