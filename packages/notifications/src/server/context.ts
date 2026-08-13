import type { NotificationMessages } from '../messages';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '../types';

/**
 * What every route in this surface shares (12-15): the actor, the request, the
 * response envelope and the body parsing. Mirrors the entity-lifecycle /
 * report-builder shape — framework-neutral descriptors a forty-line adapter
 * mounts.
 */

/**
 * What a host must resolve before a request reaches these handlers: WHO is
 * calling. That is the whole seam.
 *
 * There is no tenant here and no permission list, and both absences are the
 * design. Every endpoint in this surface is SELF-scoped — a user reads and
 * writes their own inbox and their own preferences — so the only authorization
 * question is "who is signed in", and the answer is applied by scoping every
 * query to `userId` rather than by a guard that could be forgotten. A
 * permission-gated ADMIN view of someone else's inbox would be a different
 * surface, and would need a different actor.
 */
export interface NotificationsActor {
  userId: string;
}

/** One request, already authenticated and routed by the host. */
export interface NotificationsRequest {
  actor: NotificationsActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  /** Headers the surface reads (`user-agent`, for the device hint). */
  headers?: Record<string, string | undefined>;
}

/** What a handler answers with; the adapter maps it onto its response type. */
export interface NotificationsResponse {
  status: number;
  /** `undefined` means NO body at all (204) — not the same as `null`. */
  body: unknown;
}

export interface NotificationsRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /**
   * Path relative to the host's account mount, in `:param` form. The SHAPE is
   * fixed because the packaged client builds these URLs.
   */
  path: string;
  handle(request: NotificationsRequest): Promise<NotificationsResponse>;
}

/** A user-safe API error carrying the HTTP status the wire promises. */
export class NotificationsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'NotificationsApiError';
    this.status = status;
    Object.setPrototypeOf(this, NotificationsApiError.prototype);
  }
}

/** Success is `{ data }`; a denial is `{ error }`, unwrapped. */
export const ok = (data: unknown, status = 200): NotificationsResponse => ({
  status,
  body: { data },
});

const fail = (status: number, error: string): NotificationsResponse => ({
  status,
  body: { error },
});

/** Fold a thrown {@link NotificationsApiError} into a response; rethrow the rest. */
export function foldApiError(error: unknown): NotificationsResponse {
  if (error instanceof NotificationsApiError) return fail(error.status, error.message);
  throw error;
}

/** Wrap a handler so its thrown api errors become the wire's `{ error }`. */
export function guarded(
  handle: (request: NotificationsRequest) => Promise<NotificationsResponse>,
): (request: NotificationsRequest) => Promise<NotificationsResponse> {
  return async (request) => {
    try {
      return await handle(request);
    } catch (error) {
      return foldApiError(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Body / query parsing — the request contract, in the package
// ---------------------------------------------------------------------------

function asRecord(body: unknown, messages: NotificationMessages): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return body as Record<string, unknown>;
}

/** 1..100 non-empty string ids. */
function parseIds(value: unknown, messages: NotificationMessages): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return value.map((id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new NotificationsApiError(400, messages.invalidBody);
    }
    return id;
  });
}

/**
 * Query strings arrive as strings; the store clamps, but a non-number is a
 * client bug and must not silently read as "the default page".
 */
function parseLimit(raw: string | undefined, messages: NotificationMessages): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return limit;
}

function parseFilter(
  raw: string | undefined,
  messages: NotificationMessages,
): 'all' | 'unread' | undefined {
  if (raw === undefined) return undefined;
  if (raw !== 'all' && raw !== 'unread') {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return raw;
}

/** `GET <mount>/notifications` — `filter`, `cursor`, `limit`. */
export function parseListQuery(
  query: Record<string, string | undefined>,
  messages: NotificationMessages,
): { filter?: 'all' | 'unread'; cursor?: string; limit?: number } {
  const filter = parseFilter(query.filter, messages);
  const limit = parseLimit(query.limit, messages);
  return {
    ...(filter !== undefined ? { filter } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** `POST <mount>/notifications/mark-read` — explicit ids, or `all: true`. */
export function parseMarkReadBody(
  body: unknown,
  messages: NotificationMessages,
): { all: true } | { ids: string[] } {
  const record = asRecord(body, messages);
  const wantsAll = record.all === true;
  const hasIds = record.ids !== undefined;
  // Exactly one of the two. Both, or neither, is ambiguous in the one direction
  // that matters: "mark everything read" is not a thing to guess at.
  if (wantsAll === hasIds) {
    throw new NotificationsApiError(400, messages.markReadTargetRequired);
  }
  return wantsAll ? { all: true } : { ids: parseIds(record.ids, messages) };
}

/** `POST <mount>/notifications/delete` — 1..100 ids. */
export function parseDeleteBody(body: unknown, messages: NotificationMessages): string[] {
  return parseIds(asRecord(body, messages).ids, messages);
}

/**
 * `PUT <mount>/notification-preferences` — any subset of categories, each with
 * any subset of channel toggles. Categories left out stay untouched.
 */
export function parsePreferencesBody(
  body: unknown,
  messages: NotificationMessages,
): Record<string, Partial<Record<NotificationChannel, boolean>>> {
  const record = asRecord(body, messages);
  const parsed: Record<string, Partial<Record<NotificationChannel, boolean>>> = {};
  for (const [category, value] of Object.entries(record)) {
    parsed[category] = parseToggles(value, messages);
  }
  return parsed;
}

/** One category's toggles, narrowed onto the closed channel set. */
function parseToggles(
  value: unknown,
  messages: NotificationMessages,
): Partial<Record<NotificationChannel, boolean>> {
  const toggles = asRecord(value, messages);
  const row: Partial<Record<NotificationChannel, boolean>> = {};
  for (const channel of NOTIFICATION_CHANNELS) {
    const flag = toggles[channel];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') throw new NotificationsApiError(400, messages.invalidBody);
    row[channel] = flag;
  }
  return row;
}

const MAX_ENDPOINT_CHARS = 2000;
const MAX_KEY_CHARS = 500;

function parseEndpoint(value: unknown, messages: NotificationMessages): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENDPOINT_CHARS) {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  // A push endpoint is a URL the server will POST to, so an absolute http(s)
  // URL is a hard requirement rather than a formality.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new NotificationsApiError(400, messages.invalidBody);
  }
  return value;
}

/** `POST <mount>/push-subscriptions` — `PushSubscription.toJSON()`. */
export function parsePushSubscriptionBody(
  body: unknown,
  messages: NotificationMessages,
): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const record = asRecord(body, messages);
  const keys = asRecord(record.keys, messages);
  const key = (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_CHARS) {
      throw new NotificationsApiError(400, messages.invalidBody);
    }
    return value;
  };
  return {
    endpoint: parseEndpoint(record.endpoint, messages),
    keys: { p256dh: key(keys.p256dh), auth: key(keys.auth) },
  };
}

/** `DELETE <mount>/push-subscriptions` — by endpoint. */
export function parsePushEndpointBody(body: unknown, messages: NotificationMessages): string {
  return parseEndpoint(asRecord(body, messages).endpoint, messages);
}
