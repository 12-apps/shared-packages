import { createOnboardingRepository, type OnboardingRepository } from "../repository";

import type { OnboardingRoute, OnboardingServerConfig } from "./context";
import { onboardingRoutes } from "./routes";

/**
 * The one thing this package exposes to a BACKEND host (12-23).
 *
 * Until now `@12-apps/onboarding` shipped only the React half plus a repository
 * helper, so every host still wrote the two progress endpoints itself: parse the
 * params, resolve the actor, branch on the operation, shape the response. That
 * is the surface's contract, not the host's, so it lives here — and the React
 * half's store (`createOnboardingApiStore`) talks to exactly these paths, which
 * is what stops the two halves drifting.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors (the report-builder doctrine);
 * `@12-apps/onboarding/hono` adapts them in forty lines.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication and tenant resolution** — the host hands over an
 *    `OnboardingActor` (`{ userId, clientId }`), which IS the row's isolation.
 *  - **Authorization** — the tenant-admin gate the origin host applies before
 *    delegating (`requireTenantAdminBySlug`).
 *  - **Where the data lives** — the owned model through the `db` seam.
 */
export interface ApiOnboarding {
  /** The progress surface, in mount order. */
  routes: OnboardingRoute[];
  /**
   * The same repository the routes use, for host surfaces that read the table
   * directly — e.g. the cross-tenant "who is mid-integration" reach-out list.
   */
  repository: OnboardingRepository;
}

export function createApiOnboarding(config: OnboardingServerConfig): ApiOnboarding {
  const repository = createOnboardingRepository(config.db);
  return { routes: onboardingRoutes({ config, repository }), repository };
}
