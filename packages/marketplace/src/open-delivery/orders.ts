import {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type CancellationRequestInput,
  type FetchOrderResult,
  type MarketplaceHttpResponse,
  type OutboundOrderRef,
  type OutboundResult,
  type StatusFacts,
} from "../core/adapter";
import type { NormalizedMarketplaceOrder } from "../core/types";
import { isStop, openDeliveryCall, type OpenDeliveryDialect, type OpenDeliveryStop } from "./client";

/**
 * The ORDER calls every Open Delivery adapter shares: the order fetch,
 * confirm, requestCancellation and the status steps. Paths, verbs, bodies and
 * answers are the standard's (v1.7.1 and v1.5.0 agree on all of them); the
 * job that calls these, its retries and what a failure shows are the
 * engine's. What a marketplace does differently is an option here, set by its
 * adapter folder. Tests never reach a marketplace: the HTTP client is the
 * host's port, answered by a fake.
 */

/** One authenticated call to an order's resource. */
function callOrder(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  request: { method: "GET" | "POST"; externalOrderId: string; action: string | null; body?: unknown },
): Promise<MarketplaceHttpResponse | OpenDeliveryStop> {
  const suffix = request.action === null ? "" : `/${request.action}`;
  return openDeliveryCall(ctx, dialect, {
    method: request.method,
    path: `/v1/orders/${encodeURIComponent(request.externalOrderId)}${suffix}`,
    ...(request.body === undefined ? {} : { body: request.body }),
  });
}

/** Whether a 422 answer's `CancellationError.cancellationStatus` says the order is already cancelled. */
function alreadyCancelled(response: MarketplaceHttpResponse): boolean {
  if (response.status !== 422) return false;
  try {
    return (JSON.parse(response.body) as { cancellationStatus?: unknown }).cancellationStatus === "CANCELLED";
  } catch {
    return false;
  }
}

/** {@link answered} for a fetch: a call that never got an answer is a retry. */
async function fetched(call: () => Promise<FetchOrderResult>): Promise<FetchOrderResult> {
  try {
    return await call();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** How a fetched `Order` becomes the engine's order. */
export interface OpenDeliveryFetchOptions {
  normalize(order: unknown): NormalizedMarketplaceOrder | null;
  /**
   * OPTIONAL. What the adapter does to the parsed `Order` before it is
   * normalized (Keeta's encrypted fields). Never fails the fetch.
   */
  prepare?(ctx: AdapterCallContext, order: unknown): Promise<unknown>;
}

/** `GET /v1/orders/{orderId}`: the order an event announced, normalized. A 404 is an expired order: refused. */
export function openDeliveryFetchOrder(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  order: { externalOrderId: string },
  options: OpenDeliveryFetchOptions,
): Promise<FetchOrderResult> {
  return fetched(async () => {
    const response = await callOrder(ctx, dialect, { method: "GET", externalOrderId: order.externalOrderId, action: null });
    if (isStop(response)) return response;
    const result = outboundResultOf(response);
    if (result.kind !== "accepted") return result;
    let body: unknown;
    try {
      body = JSON.parse(response.body);
    } catch {
      return { kind: "refused", status: response.status, message: "the order is not JSON" };
    }
    const prepared = options.prepare ? await options.prepare(ctx, body) : body;
    const normalized = options.normalize(prepared);
    return normalized
      ? { kind: "order", order: normalized }
      : { kind: "refused", status: response.status, message: "the order carries no id or no line" };
  });
}

/**
 * `POST /v1/orders/{orderId}/confirm` with the standard's `OrderConfirmed`:
 * `orderExternalCode` (the host's own order id) and `createdAt`, plus the
 * `preparationTime` in minutes when the store stated one. `createdAt` is sent
 * as the moment of the confirmation: ESTIMATED (the standard describes it
 * with the ORDER's creation text, a copy of another schema's).
 *
 * Every 422 is a refusal. It is the standard's generic `UnprocessableEntity`
 * ("check if the instruction has not been sent before"), and its body cannot
 * tell a duplicate from a cancelled order. So a retried confirm whose first
 * answer was lost reads "not confirmed" with the app link (a false alarm a
 * person dismisses on the marketplace), and a confirm the marketplace truly
 * refused is never stamped confirmed.
 */
export function openDeliveryConfirm(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  order: OutboundOrderRef,
  input: { preparationMinutes: number | null },
): Promise<OutboundResult> {
  return answered(async () => {
    const response = await callOrder(ctx, dialect, {
      method: "POST",
      externalOrderId: order.externalOrderId,
      action: "confirm",
      body: {
        orderExternalCode: order.hostOrderCode,
        createdAt: ctx.now.toISOString(),
        ...(input.preparationMinutes === null ? {} : { preparationTime: input.preparationMinutes }),
      },
    });
    return isStop(response) ? response : outboundResultOf(response);
  });
}

/** The standard's limit on `outOfStockItems`. */
const MAX_OUT_OF_STOCK_ITEMS = 100;

/** How a marketplace reads `RequestCancelled.outOfStockItems`. */
export interface OpenDeliveryCancellationOptions {
  /**
   * The offending SKUs (`externalCode`) are sent as `outOfStockItems` with an
   * item-unavailable reason. False where the marketplace wants its own item
   * uuids there, which the engine does not keep (99Food, v1.7.1).
   */
  outOfStockAsSkus: boolean;
}

/**
 * `POST /v1/orders/{orderId}/requestCancellation` with the standard's
 * `RequestCancelled`: `reason` (free text: the store's, else the label),
 * `code` (one of the standard's codes) and `mode` (`MANUAL` or `AUTO`). 202
 * means taken; the outcome is a later event. A 422 whose `cancellationStatus`
 * is `CANCELLED` means the order is cancelled already, which is what the
 * request wanted. A 400 is a malformed request (a bad id or body: ours); a
 * 422 is the business answer and stays a refusal.
 */
export function openDeliveryRequestCancellation(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  order: OutboundOrderRef,
  input: CancellationRequestInput,
  options: OpenDeliveryCancellationOptions,
): Promise<OutboundResult> {
  const skus =
    options.outOfStockAsSkus && input.reason.itemUnavailable && input.offendingSkus.length > 0
      ? { outOfStockItems: input.offendingSkus.slice(0, MAX_OUT_OF_STOCK_ITEMS) }
      : {};
  return answered(async () => {
    const response = await callOrder(ctx, dialect, {
      method: "POST",
      externalOrderId: order.externalOrderId,
      action: "requestCancellation",
      body: {
        reason: input.text === "" ? input.reason.label : input.text,
        code: input.reason.code,
        mode: input.mode,
        ...skus,
      },
    });
    if (isStop(response)) return response;
    if (alreadyCancelled(response)) return { kind: "accepted" };
    const result = outboundResultOf(response);
    return result.kind === "refused" && result.status === 400 ? { ...result, own: true } : result;
  });
}

/** Which standard status call a step takes, for which kind of order. */
type StatusPath = (facts: StatusFacts) => { action: string; body?: unknown } | null;

/** The status calls a marketplace serves. */
export interface OpenDeliveryStatusOptions {
  /** A take-out's HANDED_OVER is `POST /v1/orders/{id}/pickedUp`. False where the marketplace has no take-out. */
  takeoutPickedUp: boolean;
}

/**
 * The standard's status calls (FUT-4653):
 *
 * - READY: `POST /v1/orders/{id}/readyForPickup`, no body; 202. Every kind of order.
 * - DISPATCHED: `POST /v1/orders/{id}/dispatch`, body `OrderDispatched`
 *   (`deliveryTrackingInfo` optional, sent empty). Only where the logistics
 *   is the merchant's.
 * - HANDED_OVER: the merchant's bag `POST /v1/orders/{id}/delivered`; a
 *   take-out `POST /v1/orders/{id}/pickedUp` where the marketplace serves it.
 *   The marketplace's own fleet: none.
 *
 * The kind of order is `deliveredBy` (null: a take-out; ESTIMATED: an order
 * that merely omits it reads as a take-out here).
 */
function statusPaths(options: OpenDeliveryStatusOptions): Readonly<Record<string, StatusPath>> {
  return {
    READY: () => ({ action: "readyForPickup" }),
    DISPATCHED: (facts) => (facts.deliveredBy === "MERCHANT" ? { action: "dispatch", body: {} } : null),
    HANDED_OVER: (facts) =>
      facts.deliveredBy === "MERCHANT"
        ? { action: "delivered", body: {} }
        : facts.deliveredBy === null && options.takeoutPickedUp
          ? { action: "pickedUp", body: {} }
          : null,
  };
}

/** A marketplace's status half: whether a step is taken (offline), and the call that tells it. */
export function openDeliveryStatus(options: OpenDeliveryStatusOptions) {
  const paths = statusPaths(options);
  return {
    supported: (facts: StatusFacts): boolean => paths[facts.step]?.(facts) != null,
    inform(
      ctx: AdapterCallContext,
      dialect: OpenDeliveryDialect,
      order: OutboundOrderRef,
      facts: StatusFacts,
    ): Promise<OutboundResult | { kind: "unsupported" }> {
      const path = paths[facts.step]?.(facts) ?? null;
      if (path === null) return Promise.resolve({ kind: "unsupported" });
      return answered(async () => {
        const response = await callOrder(ctx, dialect, {
          method: "POST",
          externalOrderId: order.externalOrderId,
          action: path.action,
          ...(path.body === undefined ? {} : { body: path.body }),
        });
        return isStop(response) ? response : outboundResultOf(response);
      });
    },
  };
}
