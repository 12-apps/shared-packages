/**
 * `@12-apps/onboarding/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiOnboarding` (`../server`), unchanged: the two
 * progress descriptors over the `db` seam, with `featureKeys`, `resetEnabled`
 * and the REQUIRED `messages` staying the host's config. `OnboardingRequest`
 * is `WireRequest` minus the raw `request` these handlers never read, so the
 * descriptors satisfy the contract structurally — no wire view, which is what
 * the contract restating the route shape (rather than importing one) is for.
 */

import type { AnyServerManifest } from "@12-apps/wiring";

import { createApiOnboarding } from "../server";

export const onboardingServerManifest = {
  name: "@12-apps/onboarding",
  http: { create: createApiOnboarding },
} as const satisfies AnyServerManifest;
