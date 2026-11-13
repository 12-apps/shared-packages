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
 * homologation run. Also ESTIMATED: that iFood takes the client's own `id`.
 * It is sent, but the adapter does not rely on it: every create is preceded
 * by a list, and an interruption is ours when it carries our id OR, where
 * iFood assigned its own, exactly the end and the description the create
 * sent, so a retry after a lost answer never makes a second one and a resume
 * by key deletes the one that landed. An interruption the owner made by hand
 * is neither. ESTIMATED too: that there is no call to move an interruption's
 * end (so no `extend`: the engine creates the new one, then deletes the old);
 * that iFood ACCEPTS the two overlapping for that moment (if it refuses an
 * overlap, the renewal is FAILED with iFood's words and the old interruption
 * still holds to its own end); and how iFood reads a
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

/** One interruption as the list answers it, read defensively. */
interface Interruption {
  id: string;
  end: string | null;
  description: string | null;
}

/** The interruptions on the merchant, or the result that ends the call. */
async function listInterruptions(ctx: AdapterCallContext, merchantId: string): Promise<Interruption[] | Settled> {
  const response = await call(ctx, { method: "GET", url: interruptionsUrl(merchantId) });
  if (settled(response)) return response;
  const failure = notOk(response);
  if (failure) return failure;
  try {
    const parsed = JSON.parse(response.body === "" ? "[]" : response.body) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
      const value = (entry ?? {}) as { id?: unknown; end?: unknown; description?: unknown };
      if (typeof value.id !== "string") return [];
      return [
        {
          id: value.id,
          end: typeof value.end === "string" ? value.end : null,
          description: typeof value.description === "string" ? value.description : null,
        },
      ];
    });
  } catch {
    return { kind: "retry", reason: "iFood answered the interruption list with something that is not JSON" };
  }
}

/**
 * Whether iFood's `end` is the instant the create sent: the same string, the
 * same instant once parsed, or the same wall clock with the offset dropped
 * (iFood may echo the store's clock without it).
 */
function sameEnd(end: string, until: Date, timeZone: string): boolean {
  const sent = ifoodLocalTime(until, timeZone);
  if (end === sent) return true;
  const parsed = Date.parse(end);
  if (!Number.isNaN(parsed) && /[zZ]|[+-]\d{2}:?\d{2}$/u.test(end) && parsed === Math.floor(until.getTime() / 1000) * 1000) return true;
  return end.slice(0, 19) === sent.slice(0, 19);
}

/** The interruption the create under `key` made: by our id, or by the end and description it carried. */
function ours(
  list: readonly Interruption[],
  key: string,
  sent: { until: Date; reason: string; timeZone: string } | null,
): Interruption | undefined {
  const byKey = list.find((entry) => entry.id === key);
  if (byKey || !sent) return byKey;
  return list.find(
    (entry) => entry.description === sent.reason && entry.end !== null && sameEnd(entry.end, sent.until, sent.timeZone),
  );
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
    const list = await listInterruptions(ctx, request.merchantId);
    if (!Array.isArray(list)) return list;
    const landed = ours(list, request.key, { until: request.until, reason: request.reason, timeZone: request.timeZone });
    if (landed) return { kind: "paused", externalId: landed.id, until: request.until };
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

/** Delete THIS interruption: by its id, or the one a lost answer created under the key (by id, or by its end and description). */
export function ifoodResume(ctx: AdapterCallContext, ref: StorePauseRef): Promise<OutboundResult> {
  return answered(async () => {
    let id = ref.externalId;
    if (id === null && ref.key !== null) {
      const list = await listInterruptions(ctx, ref.merchantId);
      if (!Array.isArray(list)) return list;
      id = ours(list, ref.key, ref.sent)?.id ?? null;
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
