import type { AdapterCallContext, OutboundResult } from "./adapter";

/**
 * The adapter port's OPTIONAL availability capability: closing a store on a
 * marketplace for a while, and opening it again (FUT-4851).
 *
 * The owner's rules (2026-11-12), translated:
 *
 * 1. "When the kitchen is paused, the store is paused on every connected
 *    marketplace. The interruption carries the kitchen's estimated reopening
 *    time as its end, is renewed while the kitchen stays paused, and is
 *    deleted the moment the pause is over. The store is never closed on a
 *    marketplace longer than the kitchen's own pause."
 * 2. The debounce is the host's; the engine receives pause(until) and resume.
 * 3. "Never reopen a store the owner closed by hand on the marketplace, and
 *    never close one beyond what the kitchen's pause asked": the engine only
 *    deletes what IT created.
 *
 * Marketplaces close a store in one of two shapes, stated by the adapter as
 * {@link MarketplaceAvailability.kind}:
 *
 * - `interruption`: the marketplace keeps a closure with its OWN id and an
 *   END (iFood's interruptions). The engine stores the id and deletes only
 *   that id; a closure the owner made by hand is another id and is never
 *   touched. If every call after the pause is lost, the marketplace still
 *   opens the store at the end it was given.
 * - `switch`: a store-wide on/off with no id and no end (Rappi's store
 *   availability, Open Delivery's `merchantStatus`). The engine turns a store
 *   on only if its own record says it turned it off, and turns it on again by
 *   itself once the `until` it was given has passed without a renewal. What a
 *   switch cannot tell apart: an owner who ALSO closed the store by hand while
 *   the kitchen's pause stood is reopened with it. That is why a switch
 *   adapter offers the capability only when its host opts in.
 */

/** What a pause asks of one marketplace. */
export interface StorePauseRequest {
  /** The store on the marketplace: the connection's `externalMerchantId`. */
  merchantId: string;
  /** When the store should open again on its own: the kitchen's estimated reopening time. */
  until: Date;
  /** The host's words for the closure, shown to the merchant where the marketplace shows one. */
  reason: string;
  /**
   * A stable key for THIS closure, the same on every retry of it. An adapter
   * that can name its own closure sends it; one that can list closures finds
   * the closure a lost answer already created, by the key or, where the
   * marketplace assigns its own id, by the end and the reason it carries, so
   * a retry never creates a second one.
   */
  key: string;
  /** The store's IANA time zone, for a marketplace that reads times as the store's wall clock. */
  timeZone: string;
}

/** The closure the engine holds on one marketplace, as a resume or an extend names it. */
export interface StorePauseRef {
  merchantId: string;
  /** The marketplace's own id for the closure; null for a switch, or when the create's answer was lost. */
  externalId: string | null;
  /** The key the closure was created under; null once nothing of ours is in doubt. */
  key: string | null;
  /**
   * What the create under `key` carried, for a marketplace that names a
   * closure with its own id: the closure whose end and description are these
   * is the one a lost answer created. Null with no key in doubt.
   */
  sent: { until: Date; reason: string; timeZone: string } | null;
  /**
   * OPTIONAL. The marketplace ids the engine already holds (the current
   * closure, the replaced ones): a closure found under `key` is never one of
   * them, so deleting a lost create can never delete the closure that stands.
   */
  keep?: readonly string[];
}

/** One pause or extend's answer. */
export type StorePauseResult =
  /** The store is closed on the marketplace until `until`. `externalId` is null for a switch. */
  | { kind: "paused"; externalId: string | null; until: Date }
  | Exclude<OutboundResult, { kind: "accepted" }>;

/** A marketplace's way of closing a store for a while. */
export interface MarketplaceAvailability {
  /** How the marketplace holds a closure: an `interruption` with its own id and end, or a store-wide `switch`. */
  readonly kind: "interruption" | "switch";
  /**
   * Close the store until `request.until`. Idempotent under `request.key`
   * where the marketplace allows it (a stable id, or a list before the create).
   */
  pause(ctx: AdapterCallContext, request: StorePauseRequest): Promise<StorePauseResult>;
  /**
   * OPTIONAL. Move the end of the closure the engine holds. Absent: the engine
   * creates a new closure with the later end and then deletes the old one, so
   * the store is never open in between.
   */
  extend?(ctx: AdapterCallContext, ref: StorePauseRef, request: StorePauseRequest): Promise<StorePauseResult>;
  /**
   * Open the store: delete THIS closure, and nothing else. A closure already
   * gone (it ended, or a person removed it) is `accepted`: there is nothing of
   * ours left to delete.
   */
  resume(ctx: AdapterCallContext, ref: StorePauseRef): Promise<OutboundResult>;
}
