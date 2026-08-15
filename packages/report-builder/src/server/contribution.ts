/**
 * THIS PACKAGE'S OWN PERMISSION CONTRIBUTION.
 *
 * `@12-apps/report-builder` ships screens and endpoints of its own — the
 * Relatórios area, the report editor, and the `/reports/custom/**` endpoints
 * over the `saved_reports` table this package owns and migrates — so it owns
 * the permission that guards them, and exports it the way any other package
 * exports its contribution: as DATA the host composes into its catalog and
 * wires back in.
 *
 * WHAT USED TO BE HERE INSTEAD, and why it left: nothing, and that was the
 * defect. Authoring was a boolean on the actor (`canAuthor`), which every host
 * had to derive from something of its own — the origin host derived it from a
 * hardcoded `new Set(["OWNER", "ADMIN", "SUPERADMIN"])` sitting in its wiring
 * file. A permission this package's surface decides was therefore spelled in
 * the host, in role names, with no id to grant, revoke, audit or show in a role
 * editor. Meanwhile the ids that ARE the host's — `reports:sales:read`,
 * `stock:read`, `reports:kitchen:read`, which gate the origin host's orders, stock
 * ledger and kitchen lines — were hardcoded in here. Both halves were on the
 * wrong side of the boundary.
 *
 * ONE id, and deliberately only one. Reading is already decided end to end by
 * the host's own data tiers (`entityPermission`): a document whose blocks the
 * caller may not run is not listed, and an actor who reaches no entity gets
 * 403 rather than an empty page. A `reports:read` on top of that would be this
 * package writing policy into every adopter's catalog while changing nothing
 * about what anyone can see.
 *
 * The shape is `@12-apps/rbac`'s `PermissionContribution`, declared here rather
 * than imported: this package does not depend on that one (a host may run any
 * RBAC, or none), and the contribution is plain data, so
 * `composePermissions(REPORT_BUILDER_PERMISSIONS, …)` accepts it structurally.
 */

/** How a permission is decided once the actor holds it. */
export type ReportPermissionKind = 'class' | 'instance';

/** Everything true about ONE permission, in one place. */
export interface ReportPermissionSpec {
  /**
   * `'class'` — RBAC alone decides. `'instance'` — RBAC is the first gate and
   * an entity gate (ownership / assignment) runs after it.
   *
   * Required on purpose: it is the field whose absence fails OPEN, because an
   * id registered without a kind resolves to `class` and skips the entity gate.
   */
  readonly kind: ReportPermissionKind;
  /** Never composable into an inline custom role; owner-level power only. */
  readonly ownerMarker?: boolean;
  /** Ids this permission may never share a role with (separation of duties). */
  readonly separateFrom?: readonly string[];
  /** Presentation override for this exact id. */
  readonly label?: string;
}

/** The label SEGMENT vocabulary a source contributes. */
export interface ReportPermissionLabels {
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
 * PermissionContribution = define…({…})` erases the literal ids to `string`,
 * and one such branch absorbs every other in a composed union (`'a' | 'b' |
 * string` IS `string`). Annotate with `satisfies`, or not at all — the factory
 * already returns exactly this type.
 */
export interface ReportPermissionContribution<P extends string> {
  /** The owner, named in composition errors. Diagnostics, not a namespace. */
  readonly source: string;
  /** Every id this source contributes — what carries the literal union. */
  readonly ids: readonly P[];
  /** id → its whole declaration. */
  readonly permissions: Readonly<Record<string, ReportPermissionSpec>>;
  /** The segment words this source's ids read in. */
  readonly labels: ReportPermissionLabels;
}

/** The literal permission union carried by a contribution. */
export type ReportPermissionOf<T> = T extends { readonly ids: readonly (infer P)[] }
  ? P & string
  : never;

/**
 * Declare a source's permissions. The `const` type parameter keeps the map's
 * keys as literals, so the union survives without the caller writing `as
 * const`.
 */
export function definePermissionContribution<
  const M extends Record<string, ReportPermissionSpec>,
>(input: {
  source: string;
  permissions: M;
  labels?: ReportPermissionLabels;
}): ReportPermissionContribution<keyof M & string> {
  return {
    source: input.source,
    ids: Object.keys(input.permissions) as (keyof M & string)[],
    permissions: input.permissions,
    labels: input.labels ?? {},
  };
}

/** The permission guarding this package's own authoring surface. */
export const REPORT_BUILDER_PERMISSIONS = definePermissionContribution({
  source: '@12-apps/report-builder',
  permissions: {
    /**
     * Create, edit, archive and delete saved reports — and every write behind
     * the editor: the parked working copy, its publish, its discard.
     *
     * CLASS, not instance: what is gated is authoring at all, decided before
     * any document is named. WHICH documents an author then reaches is the
     * lifecycle/visibility rule (`canViewSavedReport`), which is about the
     * document's own `visibility` and its author, not about a grant.
     *
     * NOT an owner marker. Authoring a report hands out no permission and moves
     * no money; a store must be able to give it to whoever builds its reports.
     */
    'reports:manage': { kind: 'class' },
  },
  /**
   * pt-BR, matching the copy the screens already ship — and overridable per
   * host the same way those are. Only the segments THIS id uses.
   */
  labels: {
    domains: { reports: 'Relatórios' },
    actions: { manage: 'Gerenciar' },
  },
});

/** The permission union this package contributes. */
export type ReportBuilderPermission = ReportPermissionOf<typeof REPORT_BUILDER_PERMISSIONS>;

/**
 * The id this surface gates authoring with when the host names no other.
 *
 * A default, not an assumption about the host: it is THIS package's own id,
 * from the contribution above, so a host that says nothing inherits this
 * package's policy rather than some other application's. A host whose catalog
 * spells it differently passes `gatePermissions.manage`.
 */
export const DEFAULT_AUTHOR_PERMISSION: ReportBuilderPermission = 'reports:manage';
