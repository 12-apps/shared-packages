/**
 * A PERMISSION CONTRIBUTION — the unit one package hands its host.
 *
 * A permission id on its own is half a wiring. Whether RBAC alone decides it
 * (`class`) or an entity gate runs after it (`instance`), whether it is an
 * owner marker, which permission it must never share a role with, and how it
 * reads on a screen are all part of the same decision. A host asked to copy
 * four parallel lists into four config fields will eventually copy three — and
 * the id that arrives without its scope-kind is the one that fails OPEN, since
 * an unknown kind defaults to `class` and skips the entity gate entirely.
 *
 * So the id travels with everything true about it, and the package that owns
 * the surface a permission guards is the package that declares it. This file is
 * the declaration half; `./compose` is the assembly half.
 *
 * `@12-apps/rbac` declares its OWN three ids (`src/permissions.ts`) and nothing
 * else. Every other id — a host domain's, another package's — reaches the
 * factories through `composePermissions` AT THE HOST. The package never imports
 * a sibling package to find out what permissions exist, and it never ships an
 * application's catalog.
 */
import type { PermissionKind } from './types';

/**
 * Everything true about ONE permission, in one place.
 *
 * `kind` is required on purpose: it is the field whose absence fails open, so
 * there is no shape of this object that registers an id without it.
 */
export interface PermissionSpec {
  /**
   * `'class'` — RBAC alone decides. `'instance'` — RBAC is the FIRST gate and
   * the default adapter runs an entity gate (ownership / assignment / caveat)
   * before allowing a specific resource id.
   */
  readonly kind: PermissionKind;
  /**
   * An owner-level marker: never composable into an INLINE custom role, and
   * never injectable into a curated template override. Reserve it for grants
   * that WIDEN — handing out permissions, moving money.
   */
  readonly ownerMarker?: boolean;
  /**
   * Separation of duties: ids this permission may never share a single role
   * with (the author-cannot-approve rule). The counterpart may belong to
   * ANOTHER source — composition validates the reference against the full
   * assembled catalog, so `roles:approve` in a host catalog can pair against
   * `roles:manage` in this package's.
   *
   * Declaring one side is enough; the pair is derived once, symmetrically.
   */
  readonly separateFrom?: readonly string[];
  /**
   * Presentation override for this exact id, replacing the text composed from
   * its segments. The domain heading still comes from the domain label.
   */
  readonly label?: string;
}

/**
 * The label SEGMENT vocabulary a source contributes.
 *
 * Permission labels are composed from a permission's colon-separated segments
 * rather than mapped per id, so a permission nobody has translated still
 * renders (its raw segments) instead of disappearing. A source contributes the
 * words its own ids use; an unknown segment falls back to its raw text.
 */
export interface PermissionLabelVocabulary {
  /** The segment before the first `:` — the picker's group heading. */
  readonly domains?: Readonly<Record<string, string>>;
  /** Verb segments (`read`, `manage`, …). */
  readonly actions?: Readonly<Record<string, string>>;
  /** Noun segments that qualify a verb (`sales` in `reports:sales:read`). */
  readonly nouns?: Readonly<Record<string, string>>;
  /** Narrowing segments rendered in parentheses (`own`, `assigned`, …). */
  readonly scopes?: Readonly<Record<string, string>>;
}

/** The full label vocabulary a composed catalog resolves to. */
export interface RbacLabelVocabulary extends PermissionLabelVocabulary {
  /** Whole-id overrides, collected from each spec's `label`. */
  readonly permissions?: Readonly<Record<string, string>>;
  /** Role-name labels, contributed by the host's role policy. */
  readonly roles?: Readonly<Record<string, string>>;
}

/**
 * One source's contribution: who it is, what it declares, and the words its
 * ids read in. Build it with {@link definePermissionContribution}.
 */
export interface PermissionContribution<P extends string = string> {
  /**
   * The owner, named in every composition error — a package name
   * (`@12-apps/rbac`) or a host domain (`future-pay`). It is diagnostics, not
   * a namespace: ids are not prefixed with it.
   */
  readonly source: string;
  /**
   * Every id this source contributes, in declaration order. This is also what
   * carries the literal union through composition ({@link PermissionOf}).
   */
  readonly ids: readonly P[];
  /** id → its whole declaration. */
  readonly permissions: Readonly<Record<string, PermissionSpec>>;
  /** The segment words this source's ids read in. */
  readonly labels: PermissionLabelVocabulary;
}

/**
 * The literal permission union carried by a contribution or a composed
 * catalog — the thing that has to survive assembly from N sources so a host's
 * `rbac.can(actor, 'typo:here')` is still a compile error.
 */
export type PermissionOf<T> = T extends { readonly ids: readonly (infer P)[] }
  ? P & string
  : never;

/**
 * Declare a source's permissions.
 *
 * The `const` type parameter keeps the map's keys as literals, so the union
 * survives without the caller writing `as const` — and composition unions the
 * literals of every source it is given.
 *
 * @example
 * export const SHOP_PERMISSIONS = definePermissionContribution({
 *   source: 'shop',
 *   permissions: {
 *     'orders:read:own': { kind: 'instance' },
 *     'orders:refund': { kind: 'class', ownerMarker: true },
 *   },
 *   labels: { domains: { orders: 'Pedidos' } },
 * });
 * type ShopPermission = PermissionOf<typeof SHOP_PERMISSIONS>;
 */
export function definePermissionContribution<
  const M extends Record<string, PermissionSpec>,
>(input: {
  source: string;
  permissions: M;
  labels?: PermissionLabelVocabulary;
}): PermissionContribution<keyof M & string> {
  return {
    source: input.source,
    ids: Object.keys(input.permissions) as (keyof M & string)[],
    permissions: input.permissions,
    labels: input.labels ?? {},
  };
}

/** One vocabulary layered over another; the later map wins per key. */
export function mergeLabelVocabulary(
  base: RbacLabelVocabulary,
  extra: RbacLabelVocabulary | undefined,
): RbacLabelVocabulary {
  if (!extra) return base;
  return {
    domains: { ...base.domains, ...extra.domains },
    actions: { ...base.actions, ...extra.actions },
    nouns: { ...base.nouns, ...extra.nouns },
    scopes: { ...base.scopes, ...extra.scopes },
    permissions: { ...base.permissions, ...extra.permissions },
    roles: { ...base.roles, ...extra.roles },
  };
}
