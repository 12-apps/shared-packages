import type { ChannelAdapter } from "./channel";
import { MESSAGING_DEFAULTS, type MessagingEngineConfig } from "./ports";

/** The config with every default applied, and the adapters keyed by channel. */
export interface EngineContext {
  config: MessagingEngineConfig & Required<Pick<MessagingEngineConfig, keyof typeof MESSAGING_DEFAULTS>>;
  adapters: ReadonlyMap<string, ChannelAdapter>;
}

/** Build the context; a channel mounted twice is a configuration error. */
export function engineContext(config: MessagingEngineConfig): EngineContext {
  const adapters = new Map<string, ChannelAdapter>();
  for (const adapter of config.adapters) {
    if (adapters.has(adapter.kind)) throw new Error(`messaging: channel "${adapter.kind}" is mounted twice`);
    adapters.set(adapter.kind, adapter);
  }
  return {
    config: {
      ...config,
      retentionMs: config.retentionMs ?? MESSAGING_DEFAULTS.retentionMs,
      retentionBatchSize: config.retentionBatchSize ?? MESSAGING_DEFAULTS.retentionBatchSize,
      reconcileBatchSize: config.reconcileBatchSize ?? MESSAGING_DEFAULTS.reconcileBatchSize,
      maxDeliveryAttempts: config.maxDeliveryAttempts ?? MESSAGING_DEFAULTS.maxDeliveryAttempts,
      reconcileAfterMs: config.reconcileAfterMs ?? MESSAGING_DEFAULTS.reconcileAfterMs,
    },
    adapters,
  };
}
