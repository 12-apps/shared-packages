/**
 * `@12-apps/chat` — the shared vocabulary: wire types, the contact-info
 * filter, and the config error. Framework-free; every bundle may import it.
 *
 * The halves live behind their own subpaths: `./server` (routes and reads),
 * `./client` (the API client and the thread state hook), `./react` (a web
 * host's surface), `./native` (a React Native host's surface), and the wiring
 * manifests under `./manifest*`.
 */

export { ChatConfigError } from "./core/errors";
export {
  CONTACT_KINDS,
  detectContactInfo,
  type ContactKind,
  type ContactVocabulary,
} from "./core/contact";
export type {
  ChatErrorCode,
  ChatQuickReply,
  ChatThreadPayload,
  ChatWireError,
  ChatWireMessage,
  ChatWireThread,
} from "./core/types";
