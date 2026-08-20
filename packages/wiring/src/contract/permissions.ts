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
 * Twin of `PermissionContribution`: one source's ids and words. `labels` is
 * optional here where rbac requires it, so a contribution built for rbac is
 * assignable to this shape (never the reverse concern — the consumer only
 * aggregates and duplicate-checks; composing stays `composePermissions`' job).
 */
export interface WirePermissionsContribution {
  /** The owner, named in every composition error — the package's name. */
  readonly source: string;
  /** Every id this source contributes, in declaration order. */
  readonly ids: readonly string[];
  /** id → its whole declaration. */
  readonly permissions: Readonly<Record<string, WirePermissionSpec>>;
  readonly labels?: WirePermissionVocabulary;
}
