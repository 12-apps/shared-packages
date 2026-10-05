/**
 * `@12-apps/notifications/attention/react` — the round attention button, its
 * "+N", the dock it can be dragged around in, sound and vibration for news, and
 * the device's settings for all of it. Every sentence comes from the host
 * (`AttentionMessages`).
 */
export { AttentionHost, type AttentionHostProps } from './attention-host';
export { attentionView, defineAttentionViews, type AttentionKindView, type AttentionViews } from './views';
export { AttentionOthersList, type AttentionOthersListProps } from './attention-others-list';
export {
  AttentionButton,
  AttentionOthersButton,
  severityFill,
  severityInk,
  type AttentionButtonProps,
  type AttentionOthersButtonProps,
} from './attention-button';
export { AttentionDock, type AttentionDockProps, type AttentionDockRest } from './attention-dock';
export {
  AttentionCollapseButton,
  AttentionEmptyNote,
  AttentionTab,
  type AttentionCollapseButtonProps,
  type AttentionCollapsedMessages,
  type AttentionTabProps,
} from './attention-collapsible';
export {
  AttentionPreferencesPanel,
  type AttentionPreferencesPanelProps,
  type AttentionPushState,
} from './attention-preferences';
export { AttentionQuickSettings, type AttentionQuickSettingsProps } from './attention-quick-settings';
export {
  canVibrate,
  playAttentionSound,
  unlockAttentionAudio,
  useAttentionAlerts,
  useCanVibrate,
  vibrateFor,
  type AttentionSounds,
} from './alerts';
export {
  createAttentionPreferences,
  useAttentionPreferences,
  type AttentionDockPosition,
  type AttentionPreferences,
  type AttentionPreferencesStore,
} from './preferences';
export type { AttentionMessages, AttentionPreferencesMessages } from './messages';
