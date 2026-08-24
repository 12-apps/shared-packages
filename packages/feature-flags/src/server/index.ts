/**
 * The one thing this package exposes to a BACKEND host.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a router — the report-builder
 * shape, and the wiring contract's `WireRoute` structurally. The host mounts
 * them under a prefix of its own choosing and resolves the actor before any
 * handler runs; in the origin host that guard is `requireSuperadmin`, and the
 * whole surface is deliberately browser-only (no MCP contribution — a
 * superadmin bearer already inherits cross-tenant reach over shared tools).
 *
 * Route order is load-bearing for an in-order dispatcher: `/users/:userId`
 * precedes `/:key/...`, and `assertCatalog` refuses a flag named `users`, so
 * the static segment can never be swallowed by the param.
 */

import { assertFeatureFlagsConfig, type FeatureFlagsServerConfig } from "./context";
import type { FeatureFlagsRoute } from "./context";
import {
  flagsIndexRoute,
  grantByEmailRoute,
  grantRevokeRoute,
  grantsListRoute,
  grantUpdateRoute,
  userFlagsRoute,
} from "./routes";

export function createApiFeatureFlags(config: FeatureFlagsServerConfig): {
  routes: FeatureFlagsRoute[];
} {
  assertFeatureFlagsConfig(config);
  return {
    routes: [
      flagsIndexRoute(config),
      userFlagsRoute(config),
      grantsListRoute(config),
      grantByEmailRoute(config),
      grantUpdateRoute(config),
      grantRevokeRoute(config),
    ],
  };
}

export { type FeatureFlagsServerCopy } from "./copy";
export { PT_BR_FEATURE_FLAGS_SERVER_COPY } from "./pt-BR";
export { EN_US_FEATURE_FLAGS_SERVER_COPY } from "./en-US";
export { FEATURE_FLAGS_SERVER_COPY } from "./locales";
export {
  type DirectoryUser,
  type FeatureFlagsActor,
  type FeatureFlagsAuditEvent,
  type FeatureFlagsDirectory,
  type FeatureFlagsRequest,
  type FeatureFlagsResponse,
  type FeatureFlagsRoute,
  type FeatureFlagsServerConfig,
} from "./context";
