/**
 * `@12-apps/messaging` — a channel-agnostic conversational messaging
 * connector. The engine, its ports, the store port with its two
 * implementations, and the channel adapter interface. Each channel is an
 * adapter at its own subpath (`./whatsapp`); the webhook routes and job
 * blueprints are at `./server`; the wiring manifests at `./manifest`.
 */

export { createMessagingEngine, type MessagingEngine } from "./core/engine";
export {
  ChannelSendFailure,
  isWindowOpen,
  OPEN_SEND_POLICY,
  serviceWindowPolicy,
  type ChannelAdapter,
  type ChannelSendInput,
  type HandshakeAnswer,
  type SendPolicy,
  type SendPolicyContext,
  type SendPolicyVerdict,
} from "./core/channel";
export {
  MESSAGING_DEFAULTS,
  type InboundMessageNotice,
  type MessagingClockPort,
  type MessagingEngineConfig,
  type MessagingEnqueuePort,
  type MessagingHooks,
  type MessagingLogger,
  type MessagingSecretsPort,
} from "./core/ports";
export {
  MessagingConnectError,
  MessagingSendError,
  type MessagingConnectErrorCode,
  type MessagingSendErrorCode,
} from "./core/errors";
export { PROCESS_DELIVERY_JOB, type DeliveryOutcome } from "./core/inbox";
export type { EventOutcome } from "./core/inbound";
export type { SendAuthor, SendInput } from "./core/sender";
export type { ConnectInput } from "./core/connections";
export type {
  ConversationPatch,
  MessagePatch,
  MessagingStore,
  NewConnection,
  NewConversation,
  NewMessage,
  StoredConnection,
} from "./core/store";
export { createMemoryMessagingStore, type MemoryStoreDump } from "./core/memory-store";
export { createPrismaMessagingStore, type MessagingPrismaDb } from "./core/prisma-store";
export { bodyHash } from "./core/hash";
export type * from "./core/types";
