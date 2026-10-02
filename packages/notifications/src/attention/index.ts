/**
 * `@12-apps/notifications/attention` — the attention queue, framework-free:
 * declare kinds, rank what waits, and decide what is news. The button and its
 * settings are `@12-apps/notifications/attention/react`.
 */
export {
  ATTENTION_SEVERITIES,
  AttentionWiringError,
  announcementBetween,
  attentionKind,
  channelWants,
  defineAttention,
  isMoreSevere,
  pulseOf,
  readAttention,
  severityOfLap,
  snapshotOf,
  worstSeverity,
  type AttentionChannelLevel,
  type AttentionClock,
  type AttentionEntry,
  type AttentionItem,
  type AttentionKind,
  type AttentionPulse,
  type AttentionReading,
  type AttentionRegistry,
  type AttentionSeverity,
  type AttentionSnapshot,
  type AttentionWiring,
  type ReadAttentionOptions,
} from './core';
