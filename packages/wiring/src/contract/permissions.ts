/**
 * The PERMISSIONS capability: what a package contributes to the host's RBAC
 * catalog.
 *
 * `@12-apps/rbac` owns composition (`composePermissions`) and deliberately
 * accepts contributions STRUCTURALLY, so that a package declaring permissions
 * does not depend on it — `@12-apps/report-builder` restates the shape
 * locally today for exactly that reason. These twins give the restatements a
 * canonical home: a package declares against this zero-dependency shape, and
 * an rbac `PermissionContribution` satisfies it unchanged (`source`, `ids`,
 * `permissions`, `labels`).
 */

/** Twin of `@12-apps/rbac`'s `PermissionKind`. */
export type WirePermissionKind = "class" | "instance";

/** Twin of `@12-apps/rbac`'s `PermissionSpec`. `kind` is required on purpose. */
export interface WirePermissionSpec {
  readonly kind: WirePermissionKind;
  readonly ownerMarker?: boolean;
  readonly separateFrom?: readonly string[];
  readonly label?: string;
}

/** Twin of `PermissionLabelVocabulary`: the label segments a source uses. */
export interface WirePermissionVocabulary {
  readonly domains?: Readonly<Record<string, string>>;
  readonly actions?: Readonly<Record<string, string>>;
  readonly nouns?: Readonly<Record<string, string>>;
  readonly scopes?: Readonly<Record<string, string>>;
}

/**
 * A vocabulary chosen per reader — the twin of rbac's `RbacCopyResolver`.
 *
 * Restated here rather than imported for the reason every twin in this file
 * exists: a package declaring permissions must not depend on `@12-apps/rbac`,
 * and neither may depend on `@12-apps/i18n`. The context is deliberately loose,
 * matching `WireRequest.locale` — a raw language tag as some adapter handed it
 * over, unnarrowed.
 */
export type WirePermissionVocabularyResolver = (context: {
  readonly locale?: string | null;
}) => WirePermissionVocabulary;

/**
 * Twin of `PermissionContribution`: one source's ids and words. `labels` is
 * optional here where rbac requires it, so a contribution built for rbac is
 * assignable to this shape (never the reverse concern — the consumer only
 * aggregates and duplicate-checks; composing stays `composePermissions`' job).
 *
 * The ids and specs are MECHANISM and stay plain — an id is a value the wire
 * carries and a `kind` decides whether an entity gate runs, so neither may
 * follow a reader. Only `labels` admits a resolver, and it does because a
 * catalog is composed once per PROCESS: without one, the words a picker renders
 * are pinned to whatever language the catalog module was first evaluated in.
 */
export interface WirePermissionsContribution {
  /** The owner, named in every composition error — the package's name. */
  readonly source: string;
  /** Every id this source contributes, in declaration order. */
  readonly ids: readonly string[];
  /** id → its whole declaration. */
  readonly permissions: Readonly<Record<string, WirePermissionSpec>>;
  /** The segment words, or a resolver that picks a pack per reader. */
  readonly labels?: WirePermissionVocabulary | WirePermissionVocabularyResolver;
}
