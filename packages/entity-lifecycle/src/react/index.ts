/**
 * `@12-apps/entity-lifecycle/react` — the frontend half (12-17):
 * `createWebEntityLifecycle({ apiBase, copy })` returns the Lixeira +
 * Aprovações page, plus the version-history dialog and draft banner a host
 * mounts inside its own editors. Copy is REQUIRED host config; the origin
 * host's test ids are preserved so the admin specs port verbatim, and its
 * sentences ship as the named `PT_BR_LIFECYCLE_WEB_COPY` pack.
 */

export {
  createWebEntityLifecycle,
  type EntityLifecycleWebConfig,
  type WebEntityLifecycle,
} from './create-web-entity-lifecycle';
export type {
  ApprovalsCopy,
  DraftBannerCopy,
  LifecycleWebCopy,
  RecycleBinCopy,
  VersionComparisonCopy,
  VersionHistoryCopy,
} from './copy';
export { PT_BR_LIFECYCLE_WEB_COPY } from './pt-BR';
export {
  createLifecycleApiClient,
  type ApprovalRequestWire,
  type ApprovalStatusWire,
  type ComparisonCellWire,
  type ComparisonColumnWire,
  type ComparisonRoleWire,
  type ComparisonRowWire,
  type DraftWire,
  type LifecycleApiClient,
  type RecycleBinChildWire,
  type RecycleBinEntryWire,
  type VersionComparisonWire,
  type VersionWire,
  type VersionsWire,
  type WriteOutcomeWire,
} from './api';
export type { DraftBannerProps } from './draft-banner';
export type { VersionHistoryDialogProps } from './version-history-dialog';
export {
  VersionComparisonPanel,
  VersionComparisonSection,
  type VersionComparisonPanelProps,
  type VersionComparisonSectionProps,
} from './version-comparison-panel';
export { type EntityTypeLabels } from './labels';
export {
  httpLifecycleTransport,
  LifecycleHttpError,
  type LifecycleResult,
  type LifecycleTransport,
} from './transport';
