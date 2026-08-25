/**
 * THIS PACKAGE'S OWN PERMISSION CONTRIBUTION.
 *
 * `@12-apps/entitlements` ships endpoints and screens of its own — the plan
 * screen, the upgrade prompt, and the `/plan`, `/plan/request` and
 * `/entitlements` endpoints behind them — so it owns the permission that
 * guards the one WRITE on that surface, and exports it the way any other
 * package exports its contribution: as DATA the host composes into its catalog
 * and wires back.
 *
 * WHAT USED TO BE HERE INSTEAD, and why it left: nothing, and that was the
 * defect. The write was gated by `EntitlementsActor.canRequestPlanChange`, a
 * boolean every host had to derive from something of its own — the first
 * adopter derived it from a permission about editing tenant configuration,
 * named in a wiring file of its own. So a decision THIS package's surface
 * makes had no id to grant, revoke, audit or show in a role editor, and two
 * hosts would spell it two different ways for the same button.
 *
 * ONE id, and deliberately only one. Every READ on this surface is staff-wide
 * on purpose: the plan screen is what somebody opens BECAUSE a feature was
 * denied, so gating it would hide the explanation exactly when it is needed.
 * A `plan:read` would be this package writing policy into every adopter's
 * catalog while changing nothing about what anyone can see.
 *
 * The shape is `@12-apps/rbac`'s `PermissionContribution`, declared here rather
 * than imported: this package does not depend on that one (a host may run any
 * RBAC, or none), and the contribution is plain data, so
 * `composePermissions(entitlementsPermissions(labels), …)` accepts it
 * structurally.
 */

import { resolveEntitlementsCopy, type EntitlementsCopySource } from './copy';

/** How a permission is decided once the actor holds it. */
export type EntitlementPermissionKind = 'class' | 'instance';

/** Everything true about ONE permission, in one place. */
export interface EntitlementPermissionSpec {
  /**
   * `'class'` — RBAC alone decides. `'instance'` — RBAC is the first gate and
   * an entity gate (ownership / assignment) runs after it.
   *
   * Required on purpose: it is the field whose absence fails OPEN, because an
   * id registered without a kind resolves to `class` and skips the entity gate.
   */
  readonly kind: EntitlementPermissionKind;
  /** Never composable into an inline custom role; owner-level power only. */
  readonly ownerMarker?: boolean;
  /** Ids this permission may never share a role with (separation of duties). */
  readonly separateFrom?: readonly string[];
  /** Presentation override for this exact id. */
  readonly label?: string;
}

/** The label SEGMENT vocabulary a source contributes. */
export interface EntitlementPermissionLabels {
  /** The segment before the first `:` — a picker's group heading. */
  readonly domains?: Readonly<Record<string, string>>;
  /** Verb segments (`read`, `manage`, …). */
  readonly actions?: Readonly<Record<string, string>>;
  /** Noun segments that qualify a verb. */
  readonly nouns?: Readonly<Record<string, string>>;
  /** Narrowing segments rendered in parentheses (`own`, `assigned`, …). */
  readonly scopes?: Readonly<Record<string, string>>;
}

/**
 * One source's contribution: who it is, what it declares, and the words its ids
 * read in.
 *
 * `P` has NO default type argument, and that is load-bearing. With `P extends
 * string = string`, the natural-looking annotation `const X:
 * EntitlementPermissionContribution = define…({…})` erases the literal ids to
 * `string`, and one such branch absorbs every other in a composed union
 * (`'a' | 'b' | string` IS `string`). Annotate with `satisfies`, or not at all —
 * the factory already returns exactly this type.
 */
export interface EntitlementPermissionContribution<P extends string> {
  /** The owner, named in composition errors. Diagnostics, not a namespace. */
  readonly source: string;
  /** Every id this source contributes — what carries the literal union. */
  readonly ids: readonly P[];
  /** id → its whole declaration. */
  readonly permissions: Readonly<Record<string, EntitlementPermissionSpec>>;
  /** The segment words this source's ids read in. */
  readonly labels: EntitlementPermissionLabels;
}

/** The literal permission union carried by a contribution. */
export type EntitlementPermissionOf<T> = T extends {
  readonly ids: readonly (infer P)[];
}
  ? P & string
  : never;

/**
 * Declare a source's permissions. The `const` type parameter keeps the map's
 * keys as literals, so the union survives without the caller writing `as
 * const`.
 */
export function definePermissionContribution<
  const M extends Record<string, EntitlementPermissionSpec>,
>(input: {
  source: string;
  permissions: M;
  /**
   * The segment words — a pack, or a resolver that picks one per reader.
   *
   * See {@link entitlementsPermissions} for where a resolver is called and
   * why that is the composition rather than something deeper.
   */
  labels?: EntitlementsCopySource<EntitlementPermissionLabels>;
  /** Whose language to compose in. Absent means "nobody said". */
  locale?: string;
}): EntitlementPermissionContribution<keyof M & string> {
  return {
    source: input.source,
    ids: Object.keys(input.permissions) as (keyof M & string)[],
    permissions: input.permissions,
    labels: resolveEntitlementsCopy(input.labels ?? {}, input.locale),
  };
}

/**
 * The permission guarding this package's own write.
 *
 * A factory over the LABELS rather than a finished constant, because the ids
 * and their specs are mechanism and the segment words are copy: they render
 * in the host's role editor, and shipping them compiled in was this package
 * deciding the host's vocabulary (the copy-portability doctrine). Only the
 * segments THIS id uses are needed; pt-BR hosts pass
 * `PT_BR_ENTITLEMENTS_PERMISSION_LABELS` from `./pt-BR` at the same
 * composition seam the rest of their catalog is assembled at.
 *
 * ## Which language, and where that is decided
 *
 * `labels` takes a pack or a RESOLVER — `localeCopy(ENTITLEMENTS_PERMISSION_LABELS)`
 * — so a host whose readers do not share a language no longer has to reach
 * into the pack by tag and hand over a value.
 *
 * The resolver is called HERE, at the composition, and that is the honest
 * boundary rather than a shortcut. A permission catalog is not a sentence
 * rendered on demand: `composePermissions` merges every source's vocabulary
 * into one static structure, and the screens read `catalog.labels` off it. So
 * the latest moment a language can still be chosen IS the compose — a host
 * with one audience composes once, and a host whose readers differ composes
 * per reader, which is the same thing that lets a React screen's props follow
 * a locale without the props themselves being resolvers.
 *
 * Deferring further would mean widening `@12-apps/rbac`'s
 * `PermissionContribution` to carry resolvers through composition. That is a
 * real option and a different change; it is not what this field was missing.
 * What it was missing is that `localeCopy(...)` did not type-check at all,
 * which left the choice unavailable however the host composed.
 */
export function entitlementsPermissions(
  labels: EntitlementsCopySource<EntitlementPermissionLabels>,
  locale?: string,
): EntitlementPermissionContribution<'plan:request'> {
  return definePermissionContribution({
    source: '@12-apps/entitlements',
    locale,
    permissions: {
      /**
       * File a plan-change request — the one write on this surface.
       *
       * CLASS, not instance: what is gated is asking at all. There is no second
       * entity gate, because the ask is always about the caller's own tenant and
       * the route resolves that tenant server-side.
       *
       * NOT an owner marker. It moves no money and grants no capability: it
       * writes a LEAD for a human to answer, so a tenant must be able to give it
       * to whoever talks to us about their plan.
       */
      'plan:request': { kind: 'class' },
    },
    labels,
  });
}

/** The permission union this package contributes. */
export type EntitlementsPermission = EntitlementPermissionOf<
  ReturnType<typeof entitlementsPermissions>
>;

/**
 * The id this surface gates its write with when the host names no other.
 *
 * A default, not an assumption about the host: it is THIS package's own id,
 * from the contribution above, so a host that says nothing inherits this
 * package's policy rather than some other application's. A host whose catalog
 * spells it differently passes `planRequestPermission`.
 */
export const PLAN_REQUEST_PERMISSION: EntitlementsPermission = 'plan:request';
