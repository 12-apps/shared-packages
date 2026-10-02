/**
 * Every sentence the routes answer a HUMAN with — required host config, no
 * defaults (the copy-portability doctrine). The machine half of a refusal —
 * status and `error` code — stays the package's; only the words are the host's.
 *
 * A host imports a named pack (`./pt-BR`, `./en-US`) and passes it by hand,
 * or passes a RESOLVER to answer each request in its reader's language.
 */
export interface ChatServerCopy {
  /** 404 — no thread the caller may see (not a participant, or no such subject). */
  readonly notFound: string;
  /** 403 — the caller may read but no longer write. */
  readonly closed: string;
  /** 422 — the body is not the JSON object the route reads. */
  readonly invalidBody: string;
  /** 422 — nothing to send. */
  readonly empty: string;
  /** 422 — longer than the role allows; `{max}` is replaced by the limit. */
  readonly tooLong: string;
  /** 422 — the role may only send quick replies. */
  readonly freeTextDisabled: string;
  /** 422 — the quick reply key is not one the role offers. */
  readonly unknownQuickReply: string;
  /** 422 — the text carries a phone number, address, link or handle. */
  readonly contactInfo: string;
  /** 429 — too many messages in a short time. */
  readonly rateLimited: string;
}

export const SERVER_COPY_KEYS: readonly (keyof ChatServerCopy)[] = [
  "notFound",
  "closed",
  "invalidBody",
  "empty",
  "tooLong",
  "freeTextDisabled",
  "unknownQuickReply",
  "contactInfo",
  "rateLimited",
];

/** Declared structurally (no `@12-apps/i18n` dependency): a raw tag in, words out. */
export type ChatCopyResolver<T> = (context: { readonly locale?: string | null }) => T;

/** The words, or a resolver choosing them per request. */
export type ChatCopySource<T> = T | ChatCopyResolver<T>;

export function resolveCopy<T>(source: ChatCopySource<T>, locale: string | undefined): T {
  return typeof source === "function" ? (source as ChatCopyResolver<T>)({ locale }) : source;
}

/** Keys absent or blank — checked at assembly. */
export function missingCopy<T extends object>(copy: T | undefined, keys: readonly (keyof T)[]): string[] {
  if (copy === undefined || copy === null) return keys.map(String);
  return keys
    .filter((key) => {
      const value = copy[key];
      return typeof value !== "string" || value.trim() === "";
    })
    .map(String);
}
