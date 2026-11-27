import { outboundResultOf, type AdapterCallContext, type OutboundOrderRef } from "../core/adapter";
import type {
  CourierTrackingCallResult,
  MarketplaceCourierApi,
  MarketplaceCourierTracking,
  PickupCodeCallResult,
} from "../core/courier-port";
import { firstDate, firstString, pick } from "../core/payload-read";
import type { MarketplaceCourier, MarketplaceCourierStep, MarketplaceCourierVehicle, NormalizedCourierEvent } from "../core/types";
import { IFOOD_API, bearer, ifoodTokenKey } from "./outbound";

/**
 * iFood's own fleet (FUT-5665), both halves: the courier events of iFood's
 * stream, and the two calls about the courier (the pickup-code check and the
 * tracking read). Only for an order iFood's fleet carries
 * (`delivery.deliveredBy = IFOOD`); the engine never calls either for another.
 *
 * Source: the iFood research of 2026-11-26 (Levantamento, lines 95-115),
 * marked confirmed there against iFood's Order module docs; what it could not
 * confirm is marked ESTIMATED below, in this file only.
 */

/**
 * iFood's courier event codes, short and long. The four short codes and every
 * long form are confirmed; the two return events have no documented short
 * code, so only their long forms are read (ESTIMATED: none is guessed).
 */
const COURIER_STEP_OF: Readonly<Record<string, MarketplaceCourierStep>> = {
  ADR: "ASSIGNED",
  ASSIGN_DRIVER: "ASSIGNED",
  GTO: "GOING_TO_ORIGIN",
  GOING_TO_ORIGIN: "GOING_TO_ORIGIN",
  AAO: "ARRIVED_AT_ORIGIN",
  ARRIVED_AT_ORIGIN: "ARRIVED_AT_ORIGIN",
  CLT: "COLLECTED",
  COLLECTED: "COLLECTED",
  DELIVERY_RETURNING_TO_ORIGIN: "RETURNING_TO_ORIGIN",
  DELIVERY_RETURNED_TO_ORIGIN: "RETURNED_TO_ORIGIN",
};

/**
 * `workerVehicleType` as the host's closed set. ESTIMATED: the field is
 * confirmed, its values are not documented in the research; these are the
 * words a vehicle is plausibly named with, and anything else stated is OTHER.
 */
const VEHICLE_OF: Readonly<Record<string, MarketplaceCourierVehicle>> = {
  MOTORCYCLE: "MOTORCYCLE",
  MOTORBIKE: "MOTORCYCLE",
  MOTO: "MOTORCYCLE",
  BICYCLE: "BICYCLE",
  BIKE: "BICYCLE",
  CAR: "CAR",
  CARRO: "CAR",
};

/** The longest courier name kept: a longer one is truncated, never refused. */
export const IFOOD_COURIER_NAME_MAX = 120;
/** The longest photo URL kept: a longer one is dropped (a truncated URL is a broken one). */
const IFOOD_COURIER_PHOTO_URL_MAX = 2048;

/** An https URL of bounded length, or null: a photo the host renders is never another scheme. */
function httpsUrl(value: string | null): string | null {
  if (!value || value.length > IFOOD_COURIER_PHOTO_URL_MAX) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** The event's `metadata`: an object, or a JSON string of one. */
function metadataOf(payload: unknown): unknown {
  const raw = pick(payload, "metadata");
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The courier an ADR names: `workerName`, `workerPhotoUrl`, `workerVehicleType`. Null when it names nothing. */
function readCourier(payload: unknown): MarketplaceCourier | null {
  const metadata = metadataOf(payload);
  const name = firstString(metadata, [["workerName"]])?.slice(0, IFOOD_COURIER_NAME_MAX) ?? null;
  const photoUrl = httpsUrl(firstString(metadata, [["workerPhotoUrl"]]));
  const stated = firstString(metadata, [["workerVehicleType"]])?.toUpperCase() ?? null;
  const vehicle = stated === null ? null : (VEHICLE_OF[stated] ?? "OTHER");
  return name === null && photoUrl === null && vehicle === null ? null : { name, photoUrl, vehicle };
}

/** The courier step an iFood event names, or null. */
export function readIfoodCourierEvent(payload: unknown, eventType: string): NormalizedCourierEvent | null {
  const step = COURIER_STEP_OF[eventType.toUpperCase()];
  if (!step) return null;
  return {
    step,
    at: firstDate(payload, [["createdAt"]]),
    courier: step === "ASSIGNED" ? readCourier(payload) : null,
    returning: step === "RETURNING_TO_ORIGIN" ? "RETURNING" : step === "RETURNED_TO_ORIGIN" ? "RETURNED" : null,
  };
}

const orderUrl = (ref: OutboundOrderRef, action: string): string =>
  `${IFOOD_API}/order/v1.0/orders/${encodeURIComponent(ref.externalOrderId)}/${action}`;

/** One authenticated call; a 401 forgets the token so the retry fetches another. */
async function call(
  ctx: AdapterCallContext,
  request: { method: "GET" | "POST"; url: string; body?: unknown },
): Promise<{ status: number; body: string } | { kind: "refused"; status: number; message: string; own?: true } | { kind: "retry"; reason: string }> {
  const auth = await bearer(ctx);
  if (!("token" in auth)) return auth.kind === "accepted" ? { kind: "retry", reason: "no token" } : auth;
  const response = await ctx.http({
    method: request.method,
    url: request.url,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  if (response.status !== 401) return response;
  ctx.tokens.delete(ifoodTokenKey(ctx));
  return { kind: "retry", reason: "iFood refused the token" };
}

function parsed(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/**
 * `POST /order/v1.0/orders/{id}/validatePickupCode {"code"}`, answering
 * `{"valid": true|false}` (confirmed). A 2xx without a boolean `valid` is no
 * verdict: our own refusal, never read as INVALID.
 */
async function validatePickupCode(
  ctx: AdapterCallContext,
  order: OutboundOrderRef,
  input: { code: string },
): Promise<PickupCodeCallResult> {
  try {
    const response = await call(ctx, { method: "POST", url: orderUrl(order, "validatePickupCode"), body: { code: input.code } });
    if ("kind" in response) return response;
    const read = outboundResultOf(response);
    if (read.kind !== "accepted") return read;
    const valid = pick(parsed(response.body), "valid");
    return typeof valid === "boolean"
      ? { kind: "answered", valid }
      : { kind: "refused", status: response.status, message: "iFood answered without a verdict", own: true };
  } catch (error) {
    return retryOf(error);
  }
}

/** A call that never got an answer is a retry. */
function retryOf(error: unknown): { kind: "retry"; reason: string } {
  return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
}

function numberAt(source: unknown, key: string): number | null {
  const value = pick(source, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `base` plus a number of seconds, or null when either is missing. */
function plusSeconds(base: Date, seconds: number | null): Date | null {
  return seconds === null ? null : new Date(base.getTime() + seconds * 1000);
}

/**
 * The tracking body. Confirmed: latitude, longitude, `expectedDelivery`,
 * `trackDate`, and seconds to the pickup and to the delivery. ESTIMATED: the
 * names of the two second counts (`pickupEtaStart`, `deliveryEtaEnd`, or
 * `pickupEta`, `deliveryEta`), counted from `trackDate`.
 */
function readTracking(body: unknown, now: Date): MarketplaceCourierTracking {
  const trackedAt = firstDate(body, [["trackDate"]]);
  const base = trackedAt ?? now;
  const pickupSeconds = numberAt(body, "pickupEtaStart") ?? numberAt(body, "pickupEta");
  const deliverySeconds = numberAt(body, "deliveryEtaEnd") ?? numberAt(body, "deliveryEta");
  return {
    pickupEtaAt: plusSeconds(base, pickupSeconds),
    deliveryEtaAt: firstDate(body, [["expectedDelivery"]]) ?? plusSeconds(base, deliverySeconds),
    latitude: numberAt(body, "latitude"),
    longitude: numberAt(body, "longitude"),
    trackedAt,
  };
}

/** `GET /order/v1.0/orders/{id}/tracking` (confirmed): 404 before ASSIGN_DRIVER is "not yet". */
async function tracking(ctx: AdapterCallContext, order: OutboundOrderRef): Promise<CourierTrackingCallResult> {
  try {
    const response = await call(ctx, { method: "GET", url: orderUrl(order, "tracking") });
    if ("kind" in response) return response;
    if (response.status === 404) return { kind: "notYet" };
    const read = outboundResultOf(response);
    if (read.kind !== "accepted") return read;
    return { kind: "tracking", tracking: readTracking(parsed(response.body), ctx.now) };
  } catch (error) {
    return retryOf(error);
  }
}

/** iFood's courier calls, for the adapter's `courier`. */
export const IFOOD_COURIER: MarketplaceCourierApi = { validatePickupCode, tracking };
