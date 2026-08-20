/**
 * THIS PACKAGE'S PLAN-FEATURE VOCABULARY — the entitlement and quota keys its
 * route policy declares, in one place, so neither this package's route
 * builders nor an adopting host ever spells one from memory.
 *
 * The permission half already has this discipline (`DEFAULT_AUTHOR_PERMISSION`
 * in `./contribution`, and the wiring binder refuses a route permission the
 * contribution does not declare). Feature keys had no anchor at all: a key is
 * only ever compared as a string against the host's billing catalog, so a typo
 * does not fail — it silently gates nothing. These constants are the anchor;
 * the manifest suite pins their wire values.
 *
 * The KEYS are this package's suggestion, not an order: a host maps them onto
 * its own catalog when composing its entitlements. The origin host happens to
 * use them verbatim.
 */

export const REPORT_BUILDER_FEATURES = {
  /** The system reports and dashboards surface. */
  system: 'reports.system',
  /** Saved custom reports — editing and publishing gate on it; CREATION meters its quota. */
  custom: 'reports.custom',
} as const;

export type ReportBuilderFeature =
  (typeof REPORT_BUILDER_FEATURES)[keyof typeof REPORT_BUILDER_FEATURES];
