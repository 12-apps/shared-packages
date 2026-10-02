/**
 * The server surface's vocabulary: the host seams, the per-role rules, and the
 * wire-route twins.
 *
 * The request/response/route shapes are RESTATED rather than imported from
 * `@12-apps/wiring` (the structural-twin move), so the contract package stays
 * a type-only devDependency. The manifest suite pins that they still fit.
 */

import { CONTACT_KINDS, type ContactKind, type ContactVocabulary } from "../core/contact";
import { ChatConfigError } from "../core/errors";
import type { ChatQuickReply } from "../core/types";
import { missingCopy, resolveCopy, SERVER_COPY_KEYS, type ChatCopySource, type ChatServerCopy } from "./copy";
import type { ChatDb } from "./db";

/**
 * Who the caller is IN THIS THREAD, decided by the host for every request.
 * The host's whole policy lives behind it: whether this person is a party to
 * the thread at all (no ⇒ `null` ⇒ 404), under which role, and whether that
 * role may still write. The package never learns why.
 */
export interface ChatAccess {
  /** Partition key — threads never cross it. */
  readonly tenantId: string;
  /** What the thread is about, in a string the host composes (`job:123`). */
  readonly threadKey: string;
  /** The caller's role key; must be a key of the config's `roles`. */
  readonly role: string;
  /** The person, kept on their messages for moderation; never sent to the others. */
  readonly authorId: string;
  /**
   * Whose read marker this caller moves. A person's own id, or — for a role
   * whose members read as one (a team) — one shared id for the whole role.
   */
  readonly readerId: string;
  /** False ⇒ read-only: the window closed, the role lost the thread, … */
  readonly canWrite: boolean;
}

/** How one role behaves in every thread. All REQUIRED: these are host decisions. */
export interface ChatRoleConfig {
  /** The only name the thread shows for this role's messages. */
  readonly label: string;
  /**
   * True when every member of the role speaks as one (a team): their messages
   * all read as `mine` to each of them, and `readerId` is expected to be shared.
   */
  readonly shared: boolean;
  /** Longest message, in characters. */
  readonly maxLength: number;
  /** False ⇒ quick replies only. */
  readonly freeText: boolean;
  /** Contact information this role may not send; `[]` for none. */
  readonly blockContact: readonly ContactKind[];
  /** Canned lines this role may send with one tap; `[]` for none. */
  readonly quickReplies: readonly ChatQuickReply[];
  /** At most `max` messages per `windowMs`, per role and author, per thread. */
  readonly rateLimit: { readonly max: number; readonly windowMs: number };
}

/** What a committed message tells the host — notifications and live hints are the host's. */
export interface ChatMessageEvent {
  readonly tenantId: string;
  readonly threadKey: string;
  readonly message: {
    readonly id: string;
    readonly role: string;
    readonly label: string;
    readonly authorId: string;
    readonly body: string;
    /** The quick reply's key when one was sent, else `null` (free text). */
    readonly quickKey: string | null;
    readonly createdAt: string;
  };
}

/** A send the content rules refused — so the host can see who keeps trying. */
export interface ChatRefusalEvent {
  readonly tenantId: string;
  readonly threadKey: string;
  readonly role: string;
  readonly authorId: string;
  readonly code: "contact_info";
  /** What the filter found. Never the text: the host decides what it keeps. */
  readonly kinds: readonly ContactKind[];
}

export interface ChatServerConfig<TActor = unknown> {
  /** The host's Prisma client (or a structural twin), lazily. */
  db: () => ChatDb | Promise<ChatDb>;
  /** Resolve the caller's place in the thread the request names, or `null`. */
  authorize: (request: ChatRequest<TActor>) => Promise<ChatAccess | null>;
  /** Every role a thread may hold, keyed by the host's role key. */
  roles: Readonly<Record<string, ChatRoleConfig>>;
  /** Every sentence the routes answer with — host vocabulary, or a per-request resolver. */
  copy: ChatCopySource<ChatServerCopy>;
  /** Host words that widen the contact-info filter (spelled digits, app names, …). */
  contactVocabulary?: ContactVocabulary;
  /**
   * After a message commits — the host's notifications and live hints. Run in
   * the background: the send answers without waiting for it, and a throw or
   * rejection goes to `onError`, never to the sender.
   */
  onMessage?: (event: ChatMessageEvent) => void | Promise<void>;
  /** After the content rules refuse a send. Background, like `onMessage`. */
  onRefused?: (event: ChatRefusalEvent) => void | Promise<void>;
  /** Where a failing background hook is reported (`hook` names which). Silent when absent. */
  onError?: (error: unknown, context: { readonly hook: string }) => void;
  /**
   * How much of the author's own recent free text the contact rules read
   * with a draft, so a number split over several messages is still caught.
   * Defaults to the last 12 messages within 10 minutes.
   */
  contactLookback?: { readonly messages: number; readonly windowMs: number };
  /** How many messages a thread answers with, newest kept. Defaults to 200. */
  historyLimit?: number;
  /** Test seam. */
  clock?: () => Date;
}

// ─── WireRoute twins ─────────────────────────────────────────────────────────

export interface ChatRequest<TActor = unknown> {
  actor: TActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  /** BCP-47, set by the host's adapter; absent means "answer in the configured words". */
  locale?: string;
}

export interface ChatResponse {
  status: number;
  body: unknown;
}

export interface ChatRoute<TActor = unknown> {
  method: "GET" | "POST";
  /** Mount-relative. */
  path: string;
  handle(request: ChatRequest<TActor>): Promise<ChatResponse>;
}

// ─── Assembly checks ─────────────────────────────────────────────────────────

const isPositiveInt = (value: unknown): boolean => Number.isInteger(value) && (value as number) > 0;

/** Each rule a role must satisfy, with the message naming the field it broke. */
const ROLE_RULES: readonly [(role: ChatRoleConfig) => boolean, string][] = [
  [(role) => typeof role?.label === "string" && role.label.trim() !== "", "label is required."],
  [(role) => typeof role.shared === "boolean", "shared must be a boolean."],
  [(role) => isPositiveInt(role.maxLength), "maxLength must be a positive integer."],
  [(role) => typeof role.freeText === "boolean", "freeText must be a boolean."],
  [
    (role) => Array.isArray(role.blockContact) && role.blockContact.every((kind) => CONTACT_KINDS.includes(kind)),
    `blockContact must list only ${CONTACT_KINDS.join(", ")}.`,
  ],
  [(role) => isPositiveInt(role.rateLimit?.max) && isPositiveInt(role.rateLimit?.windowMs), "rateLimit needs a positive max and windowMs."],
];

/**
 * The longest message a role that blocks contact info may send. The filter
 * reads the draft with the author's recent text on every send, so its cost
 * grows with the length; a few thousand characters is no chat message.
 */
const MAX_FILTERED_LENGTH = 2000;

function assertRole(key: string, role: ChatRoleConfig): void {
  for (const [holds, message] of ROLE_RULES) {
    if (!holds(role)) throw new ChatConfigError(`roles.${key}.${message}`);
  }
  if (role.blockContact.length > 0 && role.maxLength > MAX_FILTERED_LENGTH) {
    throw new ChatConfigError(`roles.${key}.maxLength may be at most ${MAX_FILTERED_LENGTH} while blockContact is set.`);
  }
  assertQuickReplies(`roles.${key}`, role);
}

function assertQuickReply(at: string, reply: ChatQuickReply, seen: Set<string>): void {
  if (typeof reply?.key !== "string" || reply.key.trim() === "") throw new ChatConfigError(`${at}.quickReplies needs a key on every entry.`);
  if (typeof reply.text !== "string" || reply.text.trim() === "") throw new ChatConfigError(`${at}.quickReplies.${reply.key} needs text.`);
  if (seen.has(reply.key)) throw new ChatConfigError(`${at}.quickReplies repeats "${reply.key}".`);
  seen.add(reply.key);
}

function assertQuickReplies(at: string, role: ChatRoleConfig): void {
  if (!Array.isArray(role.quickReplies)) throw new ChatConfigError(`${at}.quickReplies must be a list.`);
  const seen = new Set<string>();
  role.quickReplies.forEach((reply) => assertQuickReply(at, reply, seen));
  if (!role.freeText && role.quickReplies.length === 0) {
    throw new ChatConfigError(`${at} allows no free text and offers no quick replies — it could never write.`);
  }
}

const HOOKS = ["onMessage", "onRefused", "onError"] as const;

function assertOptionalSettings(config: ChatServerConfig): void {
  for (const hook of HOOKS) {
    // A hook that is not a function would throw inside the background run, where nobody sees it.
    if (config[hook] !== undefined && typeof config[hook] !== "function") throw new ChatConfigError(`${hook} must be a function.`);
  }
  if (config.historyLimit !== undefined && !isPositiveInt(config.historyLimit)) {
    throw new ChatConfigError("historyLimit must be a positive integer.");
  }
  assertLookback(config.contactLookback);
}

function assertLookback(lookback: ChatServerConfig["contactLookback"]): void {
  if (lookback === undefined) return;
  if (!(isPositiveInt(lookback?.messages) && isPositiveInt(lookback?.windowMs))) {
    throw new ChatConfigError("contactLookback needs a positive messages and windowMs.");
  }
}

/** Throws {@link ChatConfigError} at assembly, where the call site is. */
export function assertChatServerConfig(config: ChatServerConfig): void {
  if (typeof config?.db !== "function") throw new ChatConfigError("db must be a function returning the client.");
  if (typeof config.authorize !== "function") throw new ChatConfigError("authorize is required — who may see which thread is the host's.");
  const keys = Object.keys(config.roles ?? {});
  if (keys.length === 0) throw new ChatConfigError("roles must declare at least one role.");
  keys.forEach((key) => assertRole(key, config.roles[key] as ChatRoleConfig));
  assertOptionalSettings(config);
  const missing = missingCopy(resolveCopy(config.copy, undefined), SERVER_COPY_KEYS);
  if (missing.length > 0) {
    throw new ChatConfigError(
      `copy is required, with every key non-blank — missing: ${missing.join(", ")}. A host passes a named pack by hand.`,
    );
  }
}
