/**
 * The plan-change notice as a NOTIFICATION BLUEPRINT.
 *
 * ## What this package can and cannot do about it
 *
 * A tenant moving between tiers is the single most consequential thing that
 * happens to its entitlements, and today nothing tells the tenant. The
 * adaptation matrix lists it as a "want": a real use for the capability with
 * no way to express it.
 *
 * This package declares the CONTENT and deliberately does not emit it. Moving
 * a tenant onto a tier is the platform writer's job — `POST /plan/request`
 * records a LEAD precisely so that an endpoint a tenant can reach cannot grant
 * a tenant anything — so the write this event is about happens host-side,
 * after an operator decides. A package cannot emit an event for a write it
 * does not perform, and inventing an emit here would mean either notifying on
 * the REQUEST (the wrong fact: nothing changed yet) or reaching into a write
 * this package refuses to own.
 *
 * So the host emits, through the `NotifyPort` it already binds, and what it
 * gets from here is the thing it would otherwise hand-write per host: the wire
 * type, the payload shape, and a blueprint that renders it.
 *
 * ## Why the words are an argument
 *
 * Plan names are host vocabulary — "Essencial", "Pro", "Enterprise" are a
 * commercial catalog, not a package's — and the sentence around them is host
 * copy. A blueprint pre-worded here would compile one application's tiers and
 * one language into every adopter, which is the same failure
 * `entitlementsPermissions(labels)` exists to avoid one file over. The host
 * passes its copy; `./pt-BR` and `./en-US` carry ready packs that resolve a
 * plan key through the host's own label lookup.
 *
 * ## Why the type is namespaced
 *
 * The consumer uniqueness-checks notification types ACROSS packages, so a bare
 * `plan.changed` would be a collision waiting for the second package with an
 * opinion about plans (billing has one). `entitlements.plan.changed` is unique
 * by construction and reads as its own in a host's taxonomy.
 */

/** The wire type; the host's taxonomy maps or vetoes the suggested category. */
export const PLAN_CHANGED_NOTIFICATION_TYPE = 'entitlements.plan.changed';

/** What moved, in keys — the host's copy resolves them to its own labels. */
export interface PlanChangedPayload {
  tenantId: string;
  /** The tier the tenant was on, or `null` for a tenant that had no plan. */
  fromPlanKey: string | null;
  /** The tier the tenant is on now. */
  toPlanKey: string;
  /**
   * Whether this was a move UP the catalog. The host knows its own ordering
   * (this package holds a registry, not a price ladder), and the direction is
   * what decides whether the sentence congratulates or explains.
   */
  direction: 'upgrade' | 'downgrade' | 'lateral';
}

/** Twin of the wiring contract's `WireNotificationContent`. */
export interface EntitlementsNotificationContent {
  title: string;
  body: string;
  link?: string;
  data?: Readonly<Record<string, unknown>>;
}

/** Twin of the wiring contract's `WireNotificationBlueprint`. */
export interface EntitlementsNotificationBlueprint {
  type: string;
  category: string;
  generate(payload: PlanChangedPayload): EntitlementsNotificationContent;
}

/** The host's words for the notice, and where its CTA lands. */
export interface PlanChangedCopy {
  title(payload: PlanChangedPayload): string;
  body(payload: PlanChangedPayload): string;
  /** Relative link into the host's own UI — the plan screen, typically. */
  link(payload: PlanChangedPayload): string;
}

/**
 * Build the blueprint with a host's copy. `category` suggests `system` — an
 * account notice rather than an order or payment event — and stays the host
 * taxonomy's to map or veto at adoption.
 */
export function createPlanChangedBlueprint(
  copy: PlanChangedCopy,
): EntitlementsNotificationBlueprint {
  return {
    type: PLAN_CHANGED_NOTIFICATION_TYPE,
    category: 'system',
    generate: (payload) => ({
      title: copy.title(payload),
      body: copy.body(payload),
      link: copy.link(payload),
      data: {
        tenantId: payload.tenantId,
        fromPlanKey: payload.fromPlanKey,
        toPlanKey: payload.toPlanKey,
        direction: payload.direction,
      },
    }),
  };
}

/**
 * The copy a pack needs from the host that it cannot know itself: how to spell
 * a plan key. Passed to the ready-made packs in `./pt-BR` / `./en-US`, which
 * is what keeps THEM from baking one catalog's tier names.
 */
export interface PlanLabelLookup {
  (planKey: string): string;
}
