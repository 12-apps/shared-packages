import type { AdapterCallContext, OutboundOrderRef, OutboundResult } from "./adapter";
import type { MarketplaceDeliveredBy } from "./types";

/**
 * The marketplace's own courier (FUT-5665): what an adapter can do about the
 * courier its marketplace sends, and what the host is told. Optional in every
 * type, so a host or an adapter that knows nothing of it compiles unchanged.
 */

/** Where the marketplace's courier is, as its tracking read says. Every field null when unstated. */
export interface MarketplaceCourierTracking {
  /** When the courier reaches the store: the "chega em" time. */
  pickupEtaAt: Date | null;
  /** When the marketplace expects the bag at the buyer's door. */
  deliveryEtaAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  /** When the marketplace took this reading. */
  trackedAt: Date | null;
}

/** What an adapter's pickup-code check answers: the marketplace's verdict, or why there is none. */
export type PickupCodeCallResult =
  | { kind: "answered"; valid: boolean }
  | Exclude<OutboundResult, { kind: "accepted" }>;

/**
 * What an adapter's tracking read answers: the reading; `notYet` (no courier
 * is assigned, so there is nothing to track); or the refusal and retry shapes
 * of an outbound call.
 */
export type CourierTrackingCallResult =
  | { kind: "tracking"; tracking: MarketplaceCourierTracking }
  | { kind: "notYet" }
  | Exclude<OutboundResult, { kind: "accepted" }>;

/** The courier calls one marketplace takes. Present on an adapter whose marketplace has them (iFood). */
export interface MarketplaceCourierApi {
  /**
   * Tell the marketplace the code the store checked at the hand-over, and
   * read its verdict. Called only from the `marketplace.outbound` job, action
   * `validatePickupCode`, after the host's own hand-over committed.
   */
  validatePickupCode(ctx: AdapterCallContext, order: OutboundOrderRef, input: { code: string }): Promise<PickupCodeCallResult>;
  /** Read where the courier is. Called only by `engine.courierTracking`, which the host runs in a job. */
  tracking(ctx: AdapterCallContext, order: OutboundOrderRef): Promise<CourierTrackingCallResult>;
}

/**
 * The marketplace's verdict on a pickup code, as the host is told it:
 * `VALID`, `INVALID` (the hand-over has committed: warn, move nothing) or
 * `UNVERIFIED` (no verdict came: a final refusal, retries that ran out, no
 * connection).
 */
export type PickupCodeValidation = "VALID" | "INVALID" | "UNVERIFIED";

/** What the engine tells the host with a courier event. */
export interface MarketplaceCourierFacts {
  /** Who carries the delivery, as the acceptance row holds it. */
  deliveredBy: MarketplaceDeliveredBy | null;
  /** When it happened: the event's own instant, or the engine's clock when the event states none. */
  at: Date;
}

/**
 * The host's answer to a courier event: `recorded` (it stored the facts),
 * `unchanged` (nothing to store, with the engine's reason), or `unchanged`
 * with the host's own reason, which becomes the inbox row's.
 */
export type MarketplaceCourierAnswer = "recorded" | "unchanged" | { kind: "unchanged"; reason: string };

/** What `engine.courierTracking` answers. */
export type CourierTrackingResult =
  | CourierTrackingCallResult
  /** Nothing to call: no such marketplace order, a marketplace with no tracking, or a bag the store carries itself. */
  | { kind: "unsupported"; reason: string };

/** What the host says after its hand-over committed. */
export interface ValidatePickupCodeInput {
  clientId: string;
  /** The host's order id. */
  orderId: string;
  /** The code the store checked (the one the courier stated). */
  code: string;
  /** The hand-over's own instant: it makes the job's key, so a hand-over after an undo is a new job. */
  at: Date;
}

/** The engine's courier calls (FUT-5665), part of `MarketplaceEngine`. */
export interface MarketplaceCourierEngine {
  /**
   * The store handed a marketplace courier's bag over after checking the
   * pickup code locally: ONE enqueue of `marketplace.outbound`, action
   * `validatePickupCode`, after the hand-over's commit. Never throws, runs no
   * statement and calls nobody. True when the queue took it.
   */
  validatePickupCode(input: ValidatePickupCodeInput): Promise<boolean>;
  /** Read where the marketplace's courier is: one call to the marketplace, at once. Run it from a job. */
  courierTracking(input: { clientId: string; orderId: string }): Promise<CourierTrackingResult>;
}
