/**
 * The WEB capability: how a package ships screens into a host SPA, and the
 * declarative rows the host projects nav from.
 *
 * The factory half is already a twelve-package convention (`createWebRbac`,
 * `createWebEntityLifecycle`, `createWebReportBuilder`, …): one config
 * object in, an object of component types out — memoised by the host because
 * the members are component TYPES, so a rebuild unmounts the tree. The
 * contract names that convention so a host binder can hold the memoisation
 * rule once instead of every wiring site carrying the same hazard comment.
 *
 * The declaration half is the part no package can express today: a route
 * path, a nav row, a permission gate, a plan gate. Those five are the
 * repeated host boilerplate (routes file + nav file + icon file + badge file
 * + gate pair), and two in-repo mechanisms already prove the shape — the
 * harness page registry (nav derived from a declaration) and report-builder's
 * `ReportBuilderSurface` → `nav-reports.ts` projection. An `AreaContribution`
 * is that projection's input, made a package export: rows reference surface
 * screens BY KEY, copy stays host-supplied, and composition stays an argument
 * at one call site — nothing self-registers.
 */

/** The de-facto `createWeb*` convention, named. */
export interface WebSurfaceContribution<TConfig, TSurface> {
  /**
   * Build the bound surface. Members are component TYPES — the host must
   * memoise per config identity, which the consumer's binder does once.
   */
  create(config: TConfig): TSurface;
}

/** A permission gate: one id, or ANY-of a list (the origin host's rule). */
export type WirePermissionGate = string | readonly string[];

/** One routed screen a package suggests for a host area. */
export interface AreaRouteDeclaration {
  /** Path relative to the area's root, in the SPA router's syntax. */
  path: string;
  /** Which key of the bound surface renders here. */
  screen: string;
  /** Hide without this permission (the actor can never hold it). */
  permission?: WirePermissionGate;
  /** Lock with an upsell without this plan feature (the tenant can buy it). */
  feature?: string;
}

/** One nav row a package suggests; the host owns placement and every word. */
export interface AreaNavDeclaration {
  /** Stable id — the host maps it to an icon and a label. */
  testId: string;
  /** The route it opens, by `AreaRouteDeclaration.path`. */
  path: string;
  permission?: WirePermissionGate;
  feature?: string;
  /** A badge key for an exception worklist, resolved by the host. */
  badge?: string;
}

/**
 * What a package suggests for ONE host area (`admin`, `super-admin`,
 * `client`, …). Suggestions, structurally: the host composes, reorders,
 * relabels and vetoes at its single call site.
 */
export interface AreaContribution {
  area: string;
  routes?: readonly AreaRouteDeclaration[];
  nav?: readonly AreaNavDeclaration[];
}
