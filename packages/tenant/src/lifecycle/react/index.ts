/**
 * `@12-apps/tenant/lifecycle/react`: the closing screens. Every word is the
 * host's pack, and every widget, data hook, refusal code and path is the
 * host's, injected and required, so the package ships the screens' structure
 * and behaviour, not their language, chrome or wiring.
 *
 * - `createClosingScreens`: the owner's close page (with its dialog), the
 *   banner every screen shows while closing, the screen a member a closing or
 *   closed tenant keeps out sees, and the refusal readers.
 * - `createPlatformArchive`: the platform's archive confirmation (in the
 *   host's side panel / bottom sheet) and its settings card.
 *
 * Needs `react`, `@12-apps/ui` and `@mui/icons-material` (optional peers);
 * `@12-apps/tenant/react` keeps needing none of them.
 */
export {
  createClosingScreens,
  createPlatformArchive,
  validateClosingScreens,
  validatePlatformArchive,
} from './screens';
export type { TenantClosingScreensConfig, TenantLifecycleCopyConfig, TenantLifecycleStatuses, TenantPlatformArchiveConfig } from './config';
export {
  TENANT_LIFECYCLE_SCREENS_COPY_SHAPE,
  type TenantArchivedFacts,
  type TenantEmphasis,
  type TenantLifecycleCopy,
  type TenantLifecycleScreensKeys,
} from './copy';
export { nameMatches } from './close-dialog';
export type { ClosePageProps } from './close-page';
export type { ClosingBannerProps } from './banner';
export type { TenantGoneScreenProps } from './gone-screen';
export type { ArchivePanelProps } from './archive-panel';
export type { ArchiveCardProps } from './archive-card';
export type { RefusalReaders, TenantClosingRefusal, TenantRefusalConfig } from './refusals';
export type {
  TenantCloseAnswer,
  TenantClosePageFrame,
  TenantClosingBlocker,
  TenantClosingHooks,
  TenantClosingState,
  TenantClosingView,
  TenantErrorAnswer,
  TenantLifecyclePin,
  TenantLink,
  TenantMutation,
  TenantOverlay,
  TenantPinFields,
  TenantQuery,
  TenantToast,
  TenantToastAction,
  TenantUndoNote,
} from './types';
