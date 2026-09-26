import type { TenderSplitCopy } from './copy';

/** `TenderSplit` in en-US — a named pack, never a default (see `./copy`). */
export const EN_US_TENDER_SPLIT_COPY: TenderSplitCopy = {
  launchedLabel: 'Recorded',
  missingLabel: 'Left',
  coveredLabel: 'Covered',
  over: (amount) => `Over by ${amount}`,
  progressLabel: 'How much of the bill is recorded',
  sharedHint: 'split',
  amountLabel: (tender) => `Amount in ${tender}`,
  remove: (tender) => `Remove ${tender}`,
  changeLabel: 'Change',
  pickFirst: 'Pick a method',
  missing: (amount) => `${amount} left`,
  invalid: 'Invalid amount',
  confirm: (amount) => `Confirm ${amount}`,
  cancel: 'Cancel',
};
