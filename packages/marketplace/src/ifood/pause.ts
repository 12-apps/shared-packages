import {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type MarketplaceHttpRequest,
  type MarketplaceHttpResponse,
  type OutboundResult,
} from "../core/adapter";
import type { MarketplaceAvailability, StorePauseRef, StorePauseRequest, StorePauseResult } from "../core/pause-port";
import { IFOOD_API, bearer, ifoodTokenKey } from "./outbound";

/**
 * iFood's half of the store pause (FUT-4851): the Merchant API's
 * INTERRUPTIONS, a closure with its own id, a start and an end, that does not
 * touch the store's opening hours.
 *
 * - List: `GET /merchant/v1.0/merchants/{merchantId}/interruptions`
 *   (active and future interruptions).
 * - Create: `POST …/interruptions` with `{ id, description, start, end }`,
 *   201 with the interruption.
 * - Delete: `DELETE …/interruptions/{interruptionId}`, 204.
 *
 * iFood's developer portal refuses our reader (403), so the paths, verbs and
 * the body's `description`/`start`/`end` come from two public third-party
 * clients of the API (README, "Pausing a store"): ESTIMATED until the
 * homologation run. Also ESTIMATED: that iFood takes the client's own `id`
 * (it is sent, and an interruption a lost answer created is also found by
 * listing before every create, so a retry never makes a second one); that
 * there is no call to move an interruption's end (so no `extend`: the engine
 * creates the later one, then deletes the earlier); and how iFood reads a
 * time: one client says the offset is discarded and the time read as the
 * store's own clock, so the time goes out as the store's wall clock WITH its
 * offset, which reads the same either way. A 404 on delete is "already gone".
 */

const interruptionsUrl = (merchantId: string): string =>
  `${IFOOD_API}/merchant/v1.0/merchants/${encodeURIComponent(merchantId)}/interruptions`;

type Settled = Exclude<OutboundResult, { kind: "accepted" }>;

/** One authenticated call: the raw answer, or the result that ends it. */
async function call(
  ctx: AdapterCallContext,
  request: Omit<MarketplaceHttpRequest, "headers"> & { json?: unknown },
): Promise<MarketplaceHttpResponse | Settled> {
  const auth = await bearer(ctx);
  if (!("token" in auth)) return auth.kind === "accepted" ? { kind: "retry", reason: "unexpected token answer" } : auth;
  const response = await ctx.http({
    method: request.method,
    url: request.url,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(request.json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(request.json === undefined ? {} : { body: JSON.stringify(request.json) }),
  });
  // A 401 is a token that went stale under us: forget it, and the retry fetches another.
  if (response.status !== 401) return response;
  ctx.tokens.delete(ifoodTokenKey(ctx));
  return { kind: "retry", reason: "iFood refused the token" };
}

const settled = (value: MarketplaceHttpResponse | Settled): value is Settled => "kind" in value;

/** The answer as anything but 2xx, read the engine's way. */
function notOk(response: MarketplaceHttpResponse): Settled | null {
  const result = outboundResultOf(response);
  return result.kind === "accepted" ? null : result;
}

/** The interruption ids on the merchant, or the result that ends the call. */
async function listIds(ctx: AdapterCallContext, merchantId: string): Promise<string[] | Settled> {
  const response = await call(ctx, { method: "GET", url: interruptionsUrl(merchantId) });
  if (settled(response)) return response;
  const failure = notOk(response);
  if (failure) return failure;
  try {
    const parsed = JSON.parse(response.body === "" ? "[]" : response.body) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === "string");
  } catch {
    return { kind: "retry", reason: "iFood answered the interruption list with something that is not JSON" };
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall clock of `date` in `timeZone`. */
function wallClock(date: Date, timeZone: string): WallClock {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const clock: WallClock = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of format.formatToParts(date)) {
    if (part.type in clock) clock[part.type as keyof WallClock] = Number(part.value);
  }
  return clock;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/**
 * `date` as the store's wall clock with its offset: `2026-11-13T15:30:00-03:00`.
 * Read the same whether iFood honours the offset or reads the store's clock.
 */
export function ifoodLocalTime(date: Date, timeZone: string): string {
  const local = wallClock(date, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const offset = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const abs = Math.abs(offset);
  return (
    `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}` +
    `T${pad(local.hour)}:${pad(local.minute)}:${pad(local.second)}` +
    `${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** The created interruption's id: iFood's answer, else the one the engine sent. */
function createdId(body: string, sent: string): string {
  try {
    const id = (JSON.parse(body) as { id?: unknown }).id;
    return typeof id === "string" && id !== "" ? id : sent;
  } catch {
    return sent;
  }
}

/** Close the store until `request.until`: find one a lost answer created under the key, else create it. */
export function ifoodPause(ctx: AdapterCallContext, request: StorePauseRequest): Promise<StorePauseResult> {
  return answeredPause(async () => {
    const ids = await listIds(ctx, request.merchantId);
    if (!Array.isArray(ids)) return ids;
    if (ids.includes(request.key)) return { kind: "paused", externalId: request.key, until: request.until };
    const response = await call(ctx, {
      method: "POST",
      url: interruptionsUrl(request.merchantId),
      json: {
        id: request.key,
        description: request.reason,
        start: ifoodLocalTime(ctx.now, request.timeZone),
        end: ifoodLocalTime(request.until, request.timeZone),
      },
    });
    if (settled(response)) return response;
    const failure = notOk(response);
    if (failure) return failure;
    return { kind: "paused", externalId: createdId(response.body, request.key), until: request.until };
  });
}

/** Delete THIS interruption (by its id, or found under the key a lost answer created it with). */
export function ifoodResume(ctx: AdapterCallContext, ref: StorePauseRef): Promise<OutboundResult> {
  return answered(async () => {
    let id = ref.externalId;
    if (id === null && ref.key !== null) {
      const ids = await listIds(ctx, ref.merchantId);
      if (!Array.isArray(ids)) return ids;
      id = ids.includes(ref.key) ? ref.key : null;
    }
    // Nothing of ours stands: there is nothing to delete.
    if (id === null) return { kind: "accepted" };
    const response = await call(ctx, { method: "DELETE", url: `${interruptionsUrl(ref.merchantId)}/${encodeURIComponent(id)}` });
    if (settled(response)) return response;
    // Already gone: it ended, or a person removed it.
    if (response.status === 404) return { kind: "accepted" };
    return outboundResultOf(response);
  });
}

/** {@link answered} for a pause: a call that never got an answer is a retry. */
async function answeredPause(run: () => Promise<StorePauseResult>): Promise<StorePauseResult> {
  try {
    return await run();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** iFood's availability capability: interruptions, no extend. */
export const IFOOD_AVAILABILITY: MarketplaceAvailability = {
  kind: "interruption",
  pause: ifoodPause,
  resume: ifoodResume,
};
