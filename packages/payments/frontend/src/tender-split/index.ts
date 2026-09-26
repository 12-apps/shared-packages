/**
 * `@12-apps/payments-frontend/tender-split` — "how was it paid?" for money
 * taken in person: the tenders as cards, an equal split as they are tapped,
 * typed amounts that stay put, change for the tender that gives it.
 *
 * Its own entry rather than the root barrel's: it needs none of the online
 * payments client, and a host asking only this question should not pull it.
 */
export { TenderSplit, type TenderSplitProps } from './tender-split';
export type { TenderOption } from './tender-card';
export type { TenderSplitCopy } from './copy';
export {
  parseAmount,
  readTenderSplit,
  shareEqually,
  withPicked,
  withTyped,
  withoutPicked,
  type TenderPick,
  type TenderSplitAnswer,
  type TenderSplitLeg,
  type TenderSplitOutcome,
  type TenderSplitState,
} from './math';
export { PT_BR_TENDER_SPLIT_COPY } from './pt-BR';
export { EN_US_TENDER_SPLIT_COPY } from './en-US';
