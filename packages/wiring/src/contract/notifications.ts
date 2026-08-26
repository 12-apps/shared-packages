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

/**
 * Who the content is being rendered FOR — the reader, at the moment the
 * blueprint is asked.
 *
 * A notification is stored as rendered TEXT, so the language is chosen once,
 * when the row is written. That moment is the only honest place to ask: a
 * blueprint is registered at boot, and a host that resolved its words there
 * would pin every future reader to whatever language the process started in.
 *
 * The tag is the RECIPIENT's, never the request's. The person who triggers a
 * notification is routinely not the person who reads it — an invite is sent
 * because an administrator acted, and it is read by the invitee — so
 * `Accept-Language` here would be a bug that only ever shows as somebody
 * getting told things in a language they do not speak.
 *
 * Absent means "nobody said": a host with one audience, or one that stores no
 * per-user language yet, populates nothing and the blueprint answers with its
 * default exactly as it did before this existed.
 */
export interface WireNotificationContext {
  readonly locale?: string | null;
}

/** One event type the package can render into agnostic content. */
export interface WireNotificationBlueprint<TPayload = never> {
  /** The event key, dot-namespaced (`order.paid`). One blueprint per type. */
  type: string;
  /** The SUGGESTED preference category; the host's taxonomy decides. */
  category: string;
  /**
   * Render the content for ONE recipient.
   *
   * `context` is optional so that every blueprint written before it stays
   * assignable — a one-parameter `generate` satisfies this signature, and a
   * host runtime that passes nothing is telling the truth rather than
   * inventing a language.
   */
  generate(payload: TPayload, context?: WireNotificationContext): WireNotificationContent;
}

/** Erased blueprint, for heterogeneous aggregation. */
export type AnyNotificationBlueprint = WireNotificationBlueprint<never>;
