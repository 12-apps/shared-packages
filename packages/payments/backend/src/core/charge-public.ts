/**
 * Charge-level public surface re-exported from the package root through this one
 * file, because the root sits at its size gate: store-confirmed charges and the
 * split payment's informed tax (FUT-2239).
 */
export * from './manual-charge-public';
export {
  SPLIT_ARRANGEMENTS,
  type FiscalSplitFields,
  type FiscalSplitInput,
  type SplitArrangement,
} from './fiscal-split';
