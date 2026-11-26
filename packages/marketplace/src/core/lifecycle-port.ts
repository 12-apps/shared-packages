import type { MarketplaceDeliveredBy } from "./types";

/** What the engine tells the host about the order a lifecycle event names. */
export interface MarketplaceLifecycleFacts {
  /** Who carries the delivery: the merchant's courier, the marketplace's fleet; null for a take-out or when unstated. */
  deliveredBy: MarketplaceDeliveredBy | null;
}

/**
 * The host's answer to a lifecycle event: `moved` (the order moved forward),
 * `unchanged` (it did not, with the engine's default reason), or `unchanged`
 * with the host's own reason, which becomes the inbox row's (an inbox row is
 * a human's; "no courier named for a merchant delivery" is more use than
 * "already at or past DISPATCHED").
 */
export type MarketplaceLifecycleAnswer = "moved" | "unchanged" | { kind: "unchanged"; reason: string };
