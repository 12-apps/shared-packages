/**
 * `@12-apps/ui/data-display/CardKit` — the furniture an admin list's cards and
 * row menus sit in.
 *
 * See `./CardKit.types` for where the line falls: the envelope and the repeated
 * shapes are here; the entity card that knows a domain is the consumer's.
 */
export { CardKebab } from './CardKebab';
export { CardActionsProvider, useCardActions } from './card-actions-context';
export { rowActionsToMenuItems } from './row-actions-to-menu';
export { BodyHeading, DetailColumns, Fact, Ledger, TagList } from './list-card-parts';
export { useRowConfirm, type RowConfirm, type RowConfirmCopy } from './use-row-confirm';
export { useRemoveConfirm, type CardWriteResult } from './use-remove-confirm';
export type {
  CardFactProps,
  CardLedgerLine,
  KindCardProps,
  KindListCardProps,
} from './CardKit.types';
