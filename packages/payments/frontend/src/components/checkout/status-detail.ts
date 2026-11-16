import type { PaymentShortfall, PaymentStockGone } from "@12-apps/payments-backend";

import type { OrderStatus } from "./types";

/**
 * `/status`, with the money facts a terminal token cannot carry (FUT-612):
 * a capture that arrived short (`shortfall`), or a full one the store could
 * not fulfil (`stockGone`). Both are the SERVER's statements; the client reads
 * them and never infers one from amounts, so a declined card — which the
 * server answers with no fact — keeps its own screen.
 */
export interface CheckoutStatusDetail {
  status: OrderStatus;
  shortfall?: PaymentShortfall;
  stockGone?: PaymentStockGone;
}

const RESOLUTIONS = new Set<unknown>(["REFUNDED", "REFUND_PENDING", "SETTLED", null]);
const METHODS = new Set<unknown>(["PIX", "CARD", "BOLETO"]);

const isCents = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function shortfallOf(value: unknown): PaymentShortfall | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!isCents(v.totalCents) || !isCents(v.paidCents) || !isCents(v.dueCents)) return undefined;
  if (!METHODS.has(v.paidMethod) || !RESOLUTIONS.has(v.resolution ?? null)) return undefined;
  return {
    totalCents: v.totalCents,
    paidCents: v.paidCents,
    dueCents: v.dueCents,
    paidMethod: v.paidMethod as PaymentShortfall["paidMethod"],
    resolution: (v.resolution ?? null) as PaymentShortfall["resolution"],
  };
}

function stockGoneOf(value: unknown): PaymentStockGone | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!isCents(v.receivedCents) || !Array.isArray(v.missing)) return undefined;
  return { receivedCents: v.receivedCents, missing: v.missing.filter((name): name is string => typeof name === "string") };
}

/**
 * The detail of one `/status` body. A fact this bundle cannot read — a newer
 * server's, a malformed one — is left out rather than guessed at, which is
 * exactly the screen a host with no facts renders.
 */
export function statusDetailOf(status: OrderStatus, body: Record<string, unknown>): CheckoutStatusDetail {
  const stockGone = stockGoneOf(body.stockGone);
  if (stockGone) return { status, stockGone };
  const shortfall = shortfallOf(body.shortfall);
  return shortfall ? { status, shortfall } : { status };
}
