/**
 * `@12-apps/entity-lifecycle/react` — the frontend half (12-17):
 * `createWebEntityLifecycle({ apiBase })` returns the Lixeira + Aprovações
 * page, plus the version-history dialog and draft banner a host mounts
 * inside its own editors. pt-BR product copy and the future-pay test ids are
 * preserved so the admin specs port verbatim.
 */

export {
  createWebEntityLifecycle,
  type EntityLifecycleWebConfig,
  type WebEntityLifecycle,
} from './create-web-entity-lifecycle';
export {
  createLifecycleApiClient,
  type ApprovalRequestWire,
  type ApprovalStatusWire,
  type DraftWire,
  type LifecycleApiClient,
  type RecycleBinChildWire,
  type RecycleBinEntryWire,
  type VersionWire,
  type VersionsWire,
  type WriteOutcomeWire,
} from './api';
export type { DraftBannerProps } from './draft-banner';
export type { VersionHistoryDialogProps } from './version-history-dialog';
export { type EntityTypeLabels } from './labels';
export {
  httpLifecycleTransport,
  LifecycleHttpError,
  type LifecycleResult,
  type LifecycleTransport,
} from './transport';
