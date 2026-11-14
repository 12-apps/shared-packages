/**
 * Typed errors. Every adapter maps its SDK's failures onto these, so a host
 * decides retry, hand-off and alerting once, whatever the provider.
 *
 * No error carries a credential: messages are built here, from the provider's
 * status and its own message with any secret the call used scrubbed out.
 */
import type { Refusal } from "./types";

export type LlmErrorKind =
  | "auth"
  | "rate_limit"
  | "refusal"
  | "invalid_request"
  | "unavailable"
  | "invalid_response"
  | "unsupported";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly provider: string;
  /** The provider's HTTP status, when there was one. */
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, provider: string, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.provider = provider;
    this.status = status;
  }
}

/** The credential was refused (401) or lacks permission (403). */
export class AuthError extends LlmError {
  constructor(provider: string, message: string, status?: number) {
    super("auth", provider, message, status);
    this.name = "AuthError";
  }
}

/** Too many requests. `retryAfterMs` is the provider's own hint, when given. */
export class RateLimitError extends LlmError {
  readonly retryAfterMs: number | undefined;

  constructor(provider: string, message: string, retryAfterMs?: number) {
    super("rate_limit", provider, message, 429);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** The model declined. Thrown by `ensureNotRefused`; `chat` returns it as data. */
export class RefusalError extends LlmError {
  readonly refusal: Refusal;

  constructor(provider: string, refusal: Refusal) {
    super("refusal", provider, `The model declined the request (${refusal.category ?? "uncategorized"}).`);
    this.name = "RefusalError";
    this.refusal = refusal;
  }
}

/** The request itself is wrong (400, 404, 413, 422) and will fail again as is. */
export class InvalidRequestError extends LlmError {
  constructor(provider: string, message: string, status?: number) {
    super("invalid_request", provider, message, status);
    this.name = "InvalidRequestError";
  }
}

/** The provider is down, overloaded or unreachable (5xx, 529, network). */
export class ProviderUnavailableError extends LlmError {
  constructor(provider: string, message: string, status?: number) {
    super("unavailable", provider, message, status);
    this.name = "ProviderUnavailableError";
  }
}

/** The provider answered with something this package cannot read. */
export class InvalidResponseError extends LlmError {
  constructor(provider: string, message: string) {
    super("invalid_response", provider, message);
    this.name = "InvalidResponseError";
  }
}

/** A provider, credential kind or capability nobody registered or declared. */
export class UnsupportedError extends LlmError {
  constructor(provider: string, message: string) {
    super("unsupported", provider, message);
    this.name = "UnsupportedError";
  }
}

interface ErrorShape {
  status?: unknown;
  headers?: unknown;
  message?: unknown;
  name?: unknown;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value: unknown = getter.call(headers, name);
    return typeof value === "string" ? value : undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** `retry-after-ms`, else `retry-after` in seconds or as an HTTP date. */
export function retryAfterFrom(headers: unknown, now: () => number = Date.now): number | undefined {
  const ms = Number(headerValue(headers, "retry-after-ms"));
  if (Number.isFinite(ms) && ms >= 0 && headerValue(headers, "retry-after-ms") !== undefined) return ms;
  const raw = headerValue(headers, "retry-after");
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now());
}

/** Replace every occurrence of each secret with a marker. */
function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (out, secret) => (secret.length >= 4 ? out.split(secret).join("[redacted]") : out),
    text,
  );
}

const CONNECTION_ERROR = /connection|timeout|fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|socket/i;

function shapeOf(error: unknown): ErrorShape {
  return error && typeof error === "object" ? (error as ErrorShape) : {};
}

function messageOf(shape: ErrorShape, error: unknown): string {
  return typeof shape.message === "string" ? shape.message : String(error);
}

/** The typed error for an HTTP status, or null when the status says nothing. */
function errorForStatus(provider: string, status: number, message: string, headers: unknown): LlmError | null {
  if (status === 401 || status === 403) return new AuthError(provider, message, status);
  if (status === 429) return new RateLimitError(provider, message, retryAfterFrom(headers));
  if (status >= 500 || status === 408) return new ProviderUnavailableError(provider, message, status);
  if (status >= 400) return new InvalidRequestError(provider, message, status);
  return null;
}

/**
 * Map any SDK error onto the taxonomy by its HTTP status (every official SDK
 * exposes `status`), so an adapter needs no SDK class import. An `LlmError`
 * passes through untouched, and so does anything that is not a provider
 * failure (an abort, a bug, a host exception).
 */
export function mapProviderError(provider: string, error: unknown, secrets: readonly string[] = []): unknown {
  if (error instanceof LlmError) return error;
  const shape = shapeOf(error);
  if (shape.name === "AbortError" || shape.name === "APIUserAbortError") return error;
  const text = redact(messageOf(shape, error), secrets);
  const message = `${provider}: ${text}`;
  if (typeof shape.status === "number") {
    return errorForStatus(provider, shape.status, message, shape.headers) ?? error;
  }
  return CONNECTION_ERROR.test(`${String(shape.name)} ${text}`) ? new ProviderUnavailableError(provider, message) : error;
}
