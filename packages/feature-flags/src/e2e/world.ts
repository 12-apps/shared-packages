import type { Page } from "@playwright/test";

/**
 * The port a HOST implements to run the packaged beta-cohort journeys
 * (FUT-884) — the report-builder arrangement: the scenarios and their steps
 * ship here, every assertion reads a test id or data attribute this package's
 * own screen renders (`ff-flag-<key>`, `ff-grant-<userId>`, `data-enabled`,
 * `data-grant-count`), and what is NOT portable is everything around them.
 *
 * That is the whole of this port: how the host routes to the flags surface,
 * how it restores a known cohort, and the facts the assertions have to name —
 * which betas exist, who is already enrolled, whose email is safe to try.
 * A host implements it once, adds the three globs to its bdd config, and
 * inherits every scenario the library ships, including the ones added after
 * it integrated.
 */

/** One catalog flag as a scenario has to address it — by key, never by copy. */
export interface FeatureFlagsFlagRef {
  /** The catalog key — `ff-flag-<key>` is the tile. */
  key: string;
}

/** One person of the host's directory a scenario is allowed to name. */
export interface FeatureFlagsPersonRef {
  /** What the operator types. */
  email: string;
  /** The host's user id — `ff-grant-<userId>` is the row. */
  userId: string;
}

/**
 * Facts about the host's own seed the assertions have to name. They exist
 * because a journey has to talk about SOMETHING, and none of it can live in
 * the feature files without inventing one host's fixture as though it were
 * everybody's.
 */
export interface FeatureFlagsFixtures {
  /** A beta that, at reset, has exactly ONE enrolled, enabled tester. */
  seededFlag: FeatureFlagsFlagRef;
  /** A beta that, at reset, has nobody enrolled. */
  emptyFlag: FeatureFlagsFlagRef;
  /** The one person enrolled in {@link seededFlag} at reset. */
  seededTester: FeatureFlagsPersonRef;
  /** A person the directory knows who is NOT enrolled anywhere at reset. */
  newTester: FeatureFlagsPersonRef;
  /** An email the host's directory does not know. */
  strangerEmail: string;
  /** The operator's identity — what `grantedBy` is stamped with. */
  operatorEmail: string;
}

export interface FeatureFlagsWorld {
  /** Restore the exact baseline {@link FeatureFlagsFixtures} describes. */
  reset(page: Page): Promise<void>;
  /** Route to the flags surface and wait for it to be readable. */
  openFlags(page: Page): Promise<void>;
  fixtures: FeatureFlagsFixtures;
}

let installed: FeatureFlagsWorld | null = null;

/**
 * Called once from a file in the host's own `steps` glob — playwright-bdd
 * imports every step file before the first Given, so the registration lands
 * in every worker.
 */
export function defineFeatureFlagsWorld(world: FeatureFlagsWorld): void {
  installed = world;
}

/** Read by the packaged steps; throwing names the missing integration. */
export function featureFlagsWorld(): FeatureFlagsWorld {
  if (!installed) {
    throw new Error(
      "No FeatureFlagsWorld installed — call defineFeatureFlagsWorld() from a file " +
        "in your bdd config's steps glob (see @12-apps/feature-flags/e2e).",
    );
  }
  return installed;
}
