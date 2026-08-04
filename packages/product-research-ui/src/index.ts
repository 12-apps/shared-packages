/**
 * `@12-apps/product-research-ui` — host-agnostic research screens (FUT-420).
 *
 * Everything renders through two injections: a {@link ResearchApiClient} the
 * host implements over its own API/auth, and an optional pt-BR-defaulted
 * messages layer. No fetch, no router, no tenant assumptions live here — the
 * same screens serve any vertical the engine serves.
 */
export type { ResearchApiClient } from './client';
export { DEFAULT_MESSAGES, resolveMessages } from './messages';
export type { ResearchMessages } from './messages';
export type {
  CatalogRef,
  ListPagination,
  OfferOutput,
  ResearchQueryInput,
  ResearchRequestView,
  ResearchRunView,
  RunStamp,
  SourceStatView,
  SourceSummary,
} from './types';

export { ResearchForm } from './research-form';
export type { ResearchFormProps } from './research-form';
export { SourceStatusList } from './source-status';
export type { SourceStatusListProps } from './source-status';
export { BestOfferCard } from './best-offer-card';
export type { BestOfferCardProps } from './best-offer-card';
export { OffersTable } from './offers-table';
export type { OffersTableProps } from './offers-table';
export { BestPricesWidget } from './best-prices-widget';
export type { BestPricesWidgetProps } from './best-prices-widget';
export { ResearchHistoryList } from './history-list';
export type { ResearchHistoryListProps } from './history-list';
// The repeat guard, shared with a host that renders its OWN history surface (a
// full history grid) so both offer Repetir on exactly the same rows.
export { isResearchRepeatable, RESEARCH_RUN_STALE_AFTER_MS } from './repeat-guard';
export { ResearchHomeScreen } from './research-home-screen';
export type { ResearchHomeScreenProps } from './research-home-screen';
export { ResearchRunScreen } from './research-run-screen';
export type { ResearchRunScreenProps } from './research-run-screen';
export { useResearchRun } from './use-research-run';
export type { ResearchPhase, ResearchRunState, UseResearchRunOptions } from './use-research-run';
// The realtime subscription seam (FUT-439). The wire vocabulary is re-exported
// from the engine so a host adapter needs only this package to decode events.
export { useDisconnectedRunChannel } from './run-channel';
export type {
  ResearchRunChannelInput,
  ResearchRunChannelState,
  ResearchRunWireEvent,
  UseResearchRunChannel,
} from './run-channel';
export { decodeResearchRunWireEvent, RESEARCH_RUN_REALTIME_DOMAIN } from '@12-apps/product-research';
