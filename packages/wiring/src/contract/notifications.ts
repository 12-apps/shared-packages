/**
 * The NOTIFICATIONS capability: what a package wants users told about.
 *
 * Today no package can say. `@12-apps/notifications` has generators — a
 * domain event type mapped to agnostic content — but every generator in the
 * origin host is HOST code, and a package that wants to notify gets a bespoke
 * callback invented per mount (`notifyDispatched: …`), or nothing at all:
 * RBAC records a tenant invite and the invitee is never told.
 *
 * A notification blueprint is the generator, declared by the package that
 * owns the event. It is a structural twin of `NotificationGenerator` with
 * `category` widened to `string` (categories are the host's taxonomy — the
 * host maps or vetoes each blueprint's suggested category at adoption). The
 * host feeds accepted blueprints into its notifications mount exactly as it
 * feeds its own generators.
 *
 * The other half — a package EMITTING an event at runtime — is the
 * `NotifyPort` in `./ports`, so declaring content and firing it stay two
 * capabilities: many packages declare; fewer need to emit themselves.
 */

/** Twin of `@12-apps/notifications`' `NotificationContent`. */
export interface WireNotificationContent {
  title: string;
  body: string;
  /** Relative CTA link into the host's own UI. */
  link?: string;
  data?: Readonly<Record<string, unknown>>;
}

/** One event type the package can render into agnostic content. */
export interface WireNotificationBlueprint<TPayload = never> {
  /** The event key, dot-namespaced (`order.paid`). One blueprint per type. */
  type: string;
  /** The SUGGESTED preference category; the host's taxonomy decides. */
  category: string;
  generate(payload: TPayload): WireNotificationContent;
}

/** Erased blueprint, for heterogeneous aggregation. */
export type AnyNotificationBlueprint = WireNotificationBlueprint<never>;
