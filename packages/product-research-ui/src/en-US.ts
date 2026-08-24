import { EN_US_DATA_VIEWS_COPY } from '@12-apps/ui/en-US';

import type { ResearchMessages } from './messages';

/**
 * The en-US pack — the same research screens for an English-reading audience,
 * a NAMED export a host passes by hand. The filename is what exempts this file
 * from the copy-portability gate.
 *
 * `dataViews` composes `@12-apps/ui`'s own English pack rather than restating
 * it, exactly as the pt-BR side composes the Portuguese one.
 *
 * The hedged register of the four warning hints is carried over deliberately
 * and is the reason those sentences are long. Each says what was MEASURED and
 * hands the buyer the check to make, instead of asserting a cause the guard
 * cannot know — "may add" rather than "will add", because a store with free
 * delivery that simply did not say so is in the same set, and calling its total
 * understated would be a second wrong claim replacing the first.
 */
export const EN_US_RESEARCH_MESSAGES: ResearchMessages = {
  dataViews: EN_US_DATA_VIEWS_COPY,
  formTitle: 'What do you need to buy?',
  formTermLabel: 'Product',
  // A sample search, not a sentence: it shows the SHAPE of a useful term
  // (brand, variant, pack size), so it stays a real product name.
  formTermPlaceholder: 'Coca-Cola Original 350ml can',
  formBrandLabel: 'Brand',
  formQuantityLabel: 'Quantity',
  // CEP is Brazil's postal code and the lookup is Brazilian; calling it a ZIP
  // would name a field the form does not have.
  formRegionLabel: 'Delivery CEP',
  formSubmit: 'Search prices',
  formSubmitBusy: 'Starting…',
  formTermRequired: 'Say what to search for (at least 2 letters).',
  formStartFailed: 'Could not start the search.',
  runLoadFailed: 'Could not load the search.',

  statusTitle: 'Sources searched',
  statusQuerying: 'searching…',
  statusOk: (offerCount) => `${offerCount} offer(s)`,
  statusCached: (offerCount) => `${offerCount} offer(s) · cached`,
  statusOkOutsideArea: (offerCount) => `${offerCount} offer(s) · another region`,
  statusCachedOutsideArea: (offerCount) => `${offerCount} offer(s) · another region · cached`,
  statusOkTruncated: (offerCount) => `${offerCount} offer(s) · search cut short`,
  statusCachedTruncated: (offerCount) => `${offerCount} offer(s) · search cut short · cached`,
  // Says what happened, what it costs the buyer, and what to do — in that
  // order. The delivery sentence is the load-bearing half: a search cut before
  // its simulation tier returns catalog offers with NO delivery flag, which is
  // indistinguishable on screen from offers that were verified.
  truncatedHint:
    'This source hit the search time limit and stopped before finishing. The offers ' +
    'below are real, but the list may be incomplete and delivery to the CEP you gave ' +
    'was not checked. Run the search again if you need this store complete.',
  statusFailed: 'unavailable',
  statusBudget: 'query limit reached',
  statusSkipped: 'not searched',
  statusFailureReason: (reason) => `Reason: ${reason}`,
  statusReasonUnknown:
    'The source gave no reason. Try again; if it persists, check that source configuration.',

  runQueued: 'Search queued…',
  runRunning: 'Searching the sources…',
  runFailedTitle: 'The search failed',
  degradedTitle: 'Results may be incomplete',
  degradedBody:
    'One or more sources did not answer for this search. The prices below are real, but there may be a better offer at the source that is missing.',

  bestOfferTitle: 'Best price',
  unitPriceSuffix: '/ea',
  totalFor: (quantity) => `total for ${quantity} ea`,
  packMath: (totalLabel, packQuantity, unitLabel) =>
    `${totalLabel} ÷ ${packQuantity} ea = ${unitLabel}`,
  openOffer: 'Buy at the store',
  relevance: (percent) => `${percent}% relevant`,
  availabilityInStock: 'in stock',
  availabilityOutOfStock: 'out of stock',
  availabilityUnknown: 'stock not stated',
  etaDays: (days) => `delivery ~${days} day(s)`,
  outsideAreaBadge: 'Outside the delivery area',
  outsideAreaHint:
    'This store does not deliver to the CEP you gave. The price is for the store default region and may not be deliverable here — treat it as a reference.',
  suspectUnitPriceBadge: 'Unit price looks wrong',
  // Hedged on purpose: the guard compares prices, not products, so it cannot
  // tell an unlabelled multipack from a genuinely bigger or premium item. It
  // says what it measured and hands the buyer the check to make.
  suspectUnitPriceHint:
    'This listing says 1 unit, but the price is many times the typical unit price in this search. It may be a pack whose quantity is missing from the title, or a larger size. Check the packaging at the store before comparing.',
  shippingUnknownBadge: 'Delivery cost not stated',
  // Same hedged register as the hint above: say what is MISSING and what the
  // buyer should check, never assert a cause and never guess a value. "may
  // add", not "will add" — a store with free delivery that simply did not say
  // so is also in this set.
  shippingUnknownHint:
    'This store did not state the delivery cost. The total shown is the products alone — delivery may add to it. Check delivery to your CEP at the store before comparing with the other offers.',

  offersTitle: 'Every offer',
  offersPartialTitle: 'Offers found so far',
  offersPartialNote:
    'Some sources are still answering. The order is already final — cheaper offers may appear above these. The best-price card and the unit-price warnings only appear once the search finishes.',
  offersEmptyTitle: 'No offers found',
  offersEmptyBody:
    'Try a more general term, check the packaging (can, bottle, case), or import your supplier price list as a manual source.',
  columnRank: '#',
  columnSupplier: 'Supplier',
  columnSource: 'Source',
  columnProduct: 'Product',
  columnPack: 'Pack',
  // The currency is the market's, not the reader's: these are Brazilian
  // storefront prices whichever language the buyer reads in.
  columnUnitPrice: 'R$/ea',
  columnTotal: 'Total',
  columnAvailability: 'Availability',
  columnRelevance: 'Relevance',
  columnLink: 'Store',
  packUnits: (units) => `${units} ea`,

  widgetTitle: 'Current best prices',
  widgetEmpty: 'No recent search for this product.',
  widgetSearch: 'Search prices',
  widgetOpen: 'See the full search',
  widgetFreshness: (stamp) => `prices from ${stamp}`,

  historyTitle: 'Recent searches',
  historyEmpty: 'No searches yet — the first takes seconds.',
  historyOpen: 'Open',
  historyRepeat: 'Repeat',
  historyRepeatRunningHint: 'This search is still running — open it to follow along.',
  historyViewAll: 'See all',
  historyQuantity: (quantity) => `${quantity} ea`,
  historyStatusDone: 'done',
  historyStatusRunning: 'running',
  historyStatusFailed: 'failed',
  historyStatusNone: 'queued',
};
